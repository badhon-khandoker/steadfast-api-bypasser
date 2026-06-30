const express = require('express');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const app = express();
app.use(express.json());

// ব্রাউজারটি ব্যাকগ্রাউন্ডে একবারই ওপেন হবে
let globalBrowser = null;

const initBrowser = async () => {
    if (!globalBrowser) {
        globalBrowser = await puppeteer.launch({
            headless: true,
            // ক্রোমকে আরও মানুষের মতো বানানোর জন্য এক্সট্রা আর্গুমেন্ট
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-blink-features=AutomationControlled']
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

        // স্টেপ ১: ব্রাউজার মেমোরির সেশন চেক করার জন্য সরাসরি ডেটা পেজে হিট
        await page.goto(`https://steadfast.com.bd/user/consignment/getbyphone/${phone}`, { waitUntil: 'networkidle2' });
        let rawData = await page.evaluate(() => document.body.innerText);
        
        let data = null;
        try { data = JSON.parse(rawData); } catch(e) {}

        // স্টেপ ২: যদি ডেটা না থাকে (সেশন নেই বা ক্লাউডফ্লেয়ার ধরেছে), তবে লগইন করবে
        if (!data || data.total_delivered === undefined) {
            await page.goto('https://steadfast.com.bd/login', { waitUntil: 'networkidle2' });
            
            // MAGIC FIX: ক্লাউডফ্লেয়ার পাজল সলভ হওয়া পর্যন্ত ১৫ সেকেন্ড ওয়েট করবে
            try {
                await page.waitForSelector('input[name="email"]', { timeout: 15000 });
            } catch (e) {
                throw new Error("Cloudflare Blocked or Login page taking too long.");
            }

            // বক্স ভিজিবল হওয়ার পর টাইপ করবে
            await page.type('input[name="email"]', email);
            await page.type('input[name="password"]', password);
            
            await Promise.all([
                page.waitForNavigation({ waitUntil: 'networkidle2' }),
                page.click('button[type="submit"]')
            ]);

            // লগইন শেষে আবার ডেটা পেজে হিট
            await page.goto(`https://steadfast.com.bd/user/consignment/getbyphone/${phone}`, { waitUntil: 'networkidle2' });
            rawData = await page.evaluate(() => document.body.innerText);
            try { data = JSON.parse(rawData); } catch(e) {}
        }

        await page.close(); // ট্যাব ক্লোজ

        // ডেটা ক্যালকুলেশন
        if(data && data.total_delivered !== undefined) {
            const success = parseInt(data.total_delivered);
            const cancelled = parseInt(data.total_cancelled || 0);
            const total = success + cancelled;
            const ratio = (total > 0) ? Math.round((success / total) * 100) : 100;
            return res.json({ total, ratio, status: "success" });
        }
        
        return res.status(400).json({ error: "Invalid Data Format. Cloudflare might be blocking the API." });

    } catch (error) {
        if (page) await page.close();
        return res.status(500).json({ error: "Bypass Failed: " + error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Bulletproof Bypasser running on port ${PORT}`));
