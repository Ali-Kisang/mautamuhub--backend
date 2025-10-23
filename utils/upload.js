import multer from "multer";

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    if (file.fieldname === "avatar" || file.fieldname === "photos") {
      cb(null, "uploads/");
    } else {
      cb(new Error("Invalid field name"), null);
    }
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + "_" + Math.round(Math.random() * 1e9);
    const ext = file.originalname.split(".").pop();
    const name = file.originalname.split(".")[0];
    cb(null, `${name}-${uniqueSuffix}.${ext}`);
  },
});

export const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024,  
   
  },

  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files (JPG, PNG, etc.) are allowed!'), false);
    }
  }
});