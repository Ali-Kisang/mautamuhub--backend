import express from "express";
import { getAccountsByType, getRegularAccounts, getSpaAccounts, getVIPAccounts, getVVIPAccounts } from "../controllers/sortAccountType.js";

const router = express.Router();
router.get("/regular", getRegularAccounts);
router.get("/vip", getVIPAccounts);
router.get("/vvip", getVVIPAccounts);
router.get("/spa", getSpaAccounts);
router.get("/acc/:type", getAccountsByType);

export default router;