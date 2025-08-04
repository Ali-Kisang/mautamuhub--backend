import Profile from "../models/ProfileSchema.js";
// ✅ Controller to fetch Regular account type users sorted by amount and county
export const getRegularAccounts = async (req, res) => {
  try {
    const regularUsers = await Profile.find({
      "accountType.type": "Regular",
    }).sort({ "accountType.amount": 1, "location.county": 1 }); 
    res.status(200).json(regularUsers);
  } catch (error) {
    res.status(500).json({ message: "Error fetching Regular accounts", error });
  }
};

// ✅ Controller to fetch VIP account type users sorted by amount and county
export const getVIPAccounts = async (req, res) => {
  try {
    const vipUsers = await Profile.find({
      "accountType.type": "VIP",
    }).sort({ "accountType.amount": 1, "location.county": 1 });
    res.status(200).json(vipUsers);
  } catch (error) {
    res.status(500).json({ message: "Error fetching VIP accounts", error });
  }
};

// ✅ Controller to fetch VVIP account type users sorted by amount and county
export const getVVIPAccounts = async (req, res) => {
  try {
    const vvipUsers = await Profile.find({
      "accountType.type": "VVIP",
    }).sort({ "accountType.amount": 1, "location.county": 1 });
    res.status(200).json(vvipUsers);
  } catch (error) {
    res.status(500).json({ message: "Error fetching VVIP accounts", error });
  }
};

// ✅ Controller to fetch Spa account type users sorted by amount and county
export const getSpaAccounts = async (req, res) => {
  try {
    const spaUsers = await Profile.find({
      "accountType.type": "Spa",
    }).sort({ "accountType.amount": 1, "location.county": 1 });
    res.status(200).json(spaUsers);
  } catch (error) {
    res.status(500).json({ message: "Error fetching Spa accounts", error });
  }
};

// ✅ General controller to fetch accounts by type (param) sorted by amount and county
export const getAccountsByType = async (req, res) => {
  const { type } = req.params; // expected: Regular, VIP, VVIP, Spa

  try {
    const users = await Profile.find({ "accountType.type": type }).sort({
      "accountType.amount": 1,
      "location.county": 1,
    });
    res.status(200).json(users);
  } catch (error) {
    res.status(500).json({ message: `Error fetching ${type} accounts`, error });
  }
};

// ✅ Controller to fetch all profiles for a specific userId
export const getUserAccounts = async (req, res) => {
  const { userId } = req.params;

  try {
    const userAccounts = await Profile.find({ user: userId });

    if (!userAccounts.length) {
      return res
        .status(404)
        .json({ message: "No accounts found for this user." });
    }

    res.status(200).json(userAccounts);
  } catch (error) {
    res.status(500).json({ message: "Error fetching user accounts", error });
  }
};
