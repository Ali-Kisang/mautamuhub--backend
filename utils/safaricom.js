import axios from 'axios';
import crypto from 'crypto';  
import dotenv from 'dotenv';
import fs from 'fs';  // For file logging
dotenv.config();  // Load early

// Helper to log to console + file
const logMpesa = (message, data = null) => {
  const logMsg = `${new Date().toISOString()} - ${message}${data ? `\n${JSON.stringify(data, null, 2)}` : ''}`;
  console.log(logMsg);
  try {
    fs.appendFileSync('./mpesa-logs.txt', logMsg + '\n\n');
  } catch (err) {
    // Ignore
  }
};

// Generate M-Pesa timestamp (YYYYMMDDHHmmss) in EAT (Africa/Nairobi - UTC+3)
export const getTimestamp = () => {
  const now = new Date().toLocaleString("sv", { timeZone: "Africa/Nairobi" });
  const year = now.slice(0, 4);
  const month = now.slice(5, 7);
  const day = now.slice(8, 10);
  const hour = now.slice(11, 13);
  const minute = now.slice(14, 16);
  const second = now.slice(17, 19);
  const timestamp = `${year}${month}${day}${hour}${minute}${second}`;
  logMpesa(`Generated EAT timestamp: ${timestamp}`);
  return timestamp;
};

// Generate Lipa na M-Pesa password
export const generatePassword = (shortcode, passkey, timestamp) => {
  const plain = `${shortcode}${passkey}${timestamp}`;
  const password = Buffer.from(plain).toString('base64');
  logMpesa(`Generated password (first 50 chars): ${password.substring(0, 50)}...`);
  return password;
};

// Get OAuth access token (with retry on 401)
export const getAccessToken = async (retryCount = 0) => {
  const consumerKey = process.env.MPESA_CONSUMER_KEY;
  const consumerSecret = process.env.MPESA_CONSUMER_SECRET;
  if (!consumerKey || !consumerSecret) {
    const err = new Error('Missing MPESA_CONSUMER_KEY or MPESA_CONSUMER_SECRET in .env');
    logMpesa('Token error: Missing env vars');
    throw err;
  }

  const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');
  const url = process.env.MPESA_ENV === 'sandbox' 
    ? 'https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials'
    : 'https://api.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials';  

  logMpesa('Starting token generation...');

  try {
    const { data, status } = await axios.get(url, {
      headers: { Authorization: `Basic ${auth}` },
    });

    logMpesa(`Token request successful (status: ${status})`, data);

    const token = data.access_token;
    if (!token || token === 'null') {
      const err = new Error('No access_token in response');
      logMpesa('Token error: No token in response', data);
      throw err;
    }

    const expiry = new Date(Date.now() + (data.expires_in || 3600) * 1000).toISOString();
    logMpesa(`Valid token generated (expires: ${expiry}). Preview: ${token.substring(0, 30)}...`);

    return token;
  } catch (error) {
    if (error.response?.status === 401 && retryCount < 1) {
      logMpesa('Token 401 - Retrying once...');
      return getAccessToken(retryCount + 1);
    }
    const errMsg = `Token generation failed: ${error.response?.status} - ${error.response?.data?.errorMessage || error.message}`;
    logMpesa(errMsg, error.response?.data);
    throw new Error(errMsg);
  }
};

// Initiate STK Push
export const initiateSTKPush = async (phone, amount, accountRef, transactionDesc, shortcode = process.env.MPESA_SHORTCODE, tillNumber = process.env.MPESA_TILL_NUMBER || '5680394') => {
  // ✅ TWEAK: Validate inputs early
  if (!phone || phone.length !== 12 || !phone.startsWith('2547')) {
    const err = new Error('Invalid phone: Must be 2547xxxxxxxx (12 digits)');
    logMpesa('STK Input error - Invalid phone', { phone });
    throw err;
  }
  if (!Number.isInteger(amount) || amount < 1 || amount > 999999) {
    const err = new Error('Invalid amount: Must be integer Ksh 1-999999');
    logMpesa('STK Input error - Invalid amount', { amount });
    throw err;
  }

  logMpesa(`STK Push params: phone=${phone}, amount=${amount}, ref=${accountRef}, desc=${transactionDesc}, shortcode=${shortcode}, tillNumber=${tillNumber}`);

  const timestamp = getTimestamp();
  const password = generatePassword(shortcode, process.env.MPESA_PASSKEY, timestamp);
  const token = await getAccessToken();

  const payload = {
    BusinessShortCode: shortcode,
    Password: password,
    Timestamp: timestamp,
    TransactionType: 'CustomerBuyGoodsOnline',  // ✅ For till payments
    Amount: amount,
    PartyA: phone,  
    PartyB: tillNumber,  // Till Number
    PhoneNumber: phone,
    CallBackURL: process.env.MPESA_CALLBACK_URL || 'https://your-domain.com/payments/callback', // ✅ Fallback
    AccountReference: accountRef || 'Onboarding Payment',
    TransactionDesc: transactionDesc || 'Account Type Upgrade',
  };

  logMpesa('Full STK payload being sent:', payload);

  const baseUrl = process.env.MPESA_ENV === 'sandbox' 
    ? 'https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest'
    : 'https://api.safaricom.co.ke/mpesa/stkpush/v1/processrequest'; 

  try {
    const { data, status } = await axios.post(baseUrl, payload, {
      headers: { 
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      timeout: 30000, // 30s timeout
    });

    logMpesa(`STK Push response (status: ${status})`, data);

    if (data.ResponseCode !== '0') {
      logMpesa(`STK Warning: Non-zero ResponseCode ${data.ResponseCode}: ${data.ResponseDescription}`);
      return { error: data.ResponseDescription, response: data }; // Return error for caller
    }

    return data;  
  } catch (error) {
    const status = error.response?.status || 'N/A';
    const errMsg = `STK Push failed: ${status} - ${error.response?.data?.errorMessage || error.message}`;
    logMpesa(errMsg, error.response?.data || error.message);
    throw new Error(errMsg);
  }
};