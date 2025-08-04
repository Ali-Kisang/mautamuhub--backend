import Profile from "../models/ProfileSchema.js";




export const getUsersByCounties = async (req, res) => {
  try {
    // ✅ Fetch Spa accounts, sorted by county
    const spas = await Profile.find({ "accountType.type": "Spa" })
      .sort({ "location.county": 1 })
      .exec();

    // ✅ Fetch VVIP accounts, sorted by county
    const vvipAccounts = await Profile.find({ "accountType.type": "VVIP" })
      .sort({ "location.county": 1 })
      .exec();

    // ✅ Fetch VIP accounts grouped by county
    const vipAccountsByCounty = await Profile.aggregate([
      { $match: { "accountType.type": "VIP" } },
      {
        $group: {
          _id: "$location.county",
          users: { $push: "$$ROOT" },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    // ✅ Fetch Regular accounts grouped by county
    const regularAccountsByCounty = await Profile.aggregate([
      { $match: { "accountType.type": "Regular" } },
      {
        $group: {
          _id: "$location.county",
          users: { $push: "$$ROOT" },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    // ✅ Respond
    res.status(200).json({
      spas,
      vvipAccounts,
      vipAccountsByCounty,
      regularAccountsByCounty,
    });
  } catch (error) {
    console.error("Error fetching profiles by county:", error);
    res.status(500).json({ message: "Error fetching accounts", error });
  }
};