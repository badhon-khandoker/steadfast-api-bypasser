const express = require('express');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const app = express();
app.use(express.json());

// গ্লোবাল ভেরিয়েবল (ব্রাউজার এবং কুকি ক্যাশ করার জন্য)
let globalBrowser = null;
let cachedCookies = null;

// শুরুতে একবার ব্রাউজার লঞ্চ করে রাখা
const initBrowser = async () => {
    if (!globalBrowser) {
        globalBrowser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
        });
    }
};
initBrowser();

app.post('/api/steadfast', async (req, res) => {
    const { phone, email, password } = req.body;
    if(!phone || !email || !password) return res.status(400).json({ error: "Missing credentials" });

    if (!globalBrowser) await initBrowser();
    
    let page;
    try {
        page = await globalBrowser.newPage();

        // ইমেজ, CSS, ফন্ট ব্লক করা (সুপার ফাস্ট লোডিংয়ের জন্য)
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            if (['image', 'stylesheet', 'font', 'media'].includes(req.resourceType())) {
                req.abort();
            } else {
                req.continue();
            }
        });

        // যদি আগে থেকে ক্যাশ করা কুকি থাকে, তবে লগইন স্কিপ করবে
        if (cachedCookies) {
            await page.setCookie(...cachedCookies);
            await page.goto(`https://steadfast.com.bd/user/consignment/getbyphone/${phone}`, { waitUntil: 'domcontentloaded' });
            
            // সেশন এক্সপায়ার হয়ে লগইন পেজে রিডাইরেক্ট হলে কুকি রিসেট করবে
            if (page.url().includes('/login')) {
                cachedCookies = null;
            }
        }

        // যদি কুকি না থাকে বা এক্সপায়ার হয়ে যায়, তবে নতুন করে লগইন করবে
        if (!cachedCookies) {
            await page.goto('https://steadfast.com.bd/login', { waitUntil: 'domcontentloaded' });
            await page.type('input[name="email"]', email);
            await page.type('input[name="password"]', password);
            
            await Promise.all([
                page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
                page.click('button[type="submit"]')
            ]);

            // নতুন কুকি সেভ করে রাখা হচ্ছে
            cachedCookies = await page.cookies();
            await page.goto(`https://steadfast.com.bd/user/consignment/getbyphone/${phone}`, { waitUntil: 'domcontentloaded' });
        }

        // ডেটা রিড করা
        const rawData = await page.evaluate(() => document.querySelector("body").innerText);
        const data = JSON.parse(rawData);

        await page.close(); // শুধু ট্যাব ক্লোজ হবে, ব্রাউজার ওপেন থাকবে

        if(data && data.total_delivered !== undefined) {
            const success = parseInt(data.total_delivered);
            const cancelled = parseInt(data.total_cancelled || 0);
            const total = success + cancelled;
            const ratio = (total > 0) ? Math.round((success / total) * 100) : 100;
            return res.json({ total, ratio, status: "success" });
        }
        return res.status(400).json({ error: "Invalid Data" });

    } catch (error) {
        if (page) await page.close();
        cachedCookies = null; // কোনো এরর হলে কুকি রিসেট
        return res.status(500).json({ error: "Bypass Failed: " + error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Super Fast Bypasser running on port ${PORT}`));
