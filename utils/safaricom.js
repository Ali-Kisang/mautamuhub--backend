import axios from 'axios';
import crypto from 'crypto';  
import dotenv from 'dotenv';
dotenv.config();

// Generate M-Pesa timestamp (YYYYMMDDHHmmss) in UTC
export const getTimestamp = () => {
  const now = new Date().toISOString();  // Ensures UTC time
  const year = now.slice(0, 4);
  const month = now.slice(5, 7);
  const day = now.slice(8, 10);
  const hour = now.slice(11, 13);
  const minute = now.slice(14, 16);
  const second = now.slice(17, 19);
  return `${year}${month}${day}${hour}${minute}${second}`;
};

// Generate Lipa na M-Pesa password (Base64 of Shortcode + Passkey + Timestamp)
export const generatePassword = (shortcode, passkey, timestamp) => {
  const plain = `${shortcode}${passkey}${timestamp}`;
  return Buffer.from(plain).toString('base64');
};

// Get OAuth access token
export const getAccessToken = async () => {
  const consumerKey = process.env.MPESA_CONSUMER_KEY;
  const consumerSecret = process.env.MPESA_CONSUMER_SECRET;
  const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');
  const url = 'https://api.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials';  

  try {
    const { data } = await axios.get(url, {
      headers: { Authorization: `Basic ${auth}` },
    });
    return data.access_token;
  } catch (error) {
    throw new Error(`Token generation failed: ${error.response?.data?.errorMessage || error.message}`);
  }
};

// Initiate STK Push (Lipa na M-Pesa Online)
export const initiateSTKPush = async (phone, amount, accountRef, transactionDesc, shortcode = process.env.MPESA_SHORTCODE) => {
  const timestamp = getTimestamp();
  const password = generatePassword(shortcode, process.env.MPESA_PASSKEY, timestamp);
  const token = await getAccessToken();

  const payload = {
    BusinessShortCode: shortcode,
    Password: password,
    Timestamp: timestamp,
    TransactionType: 'CustomerPayBillOnline',
    Amount: amount,
    PartyA: phone,  
    PartyB: shortcode,
    PhoneNumber: phone,
    CallBackURL: process.env.MPESA_CALLBACK_URL,
    AccountReference: accountRef || 'Onboarding Payment',
    TransactionDesc: transactionDesc || 'Account Type Upgrade',
  };

  const url = 'https://api.safaricom.co.ke/mpesa/stkpush/v1/processrequest'; 
  try {
    const { data } = await axios.post(url, payload, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return data;  
  } catch (error) {
    throw new Error(`STK Push failed: ${error.response?.data?.errorMessage || error.message}`);
  }
};