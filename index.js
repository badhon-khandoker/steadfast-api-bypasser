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

        // ফাস্ট লোডিংয়ের জন্য ইমেজ এবং CSS ব্লক
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            if (['image', 'stylesheet', 'font', 'media'].includes(req.resourceType())) {
                req.abort();
            } else {
                req.continue();
            }
        });

        // স্টেপ ১: ব্রাউজার মেমোরির সেশন চেক করার জন্য সরাসরি ডেটা পেজে হিট
        await page.goto(`https://steadfast.com.bd/user/consignment/getbyphone/${phone}`, { waitUntil: 'domcontentloaded' });
        let rawData = await page.evaluate(() => document.body.innerText);
        
        let data = null;
        try { data = JSON.parse(rawData); } catch(e) {}

        // স্টেপ ২: যদি ডেটা না থাকে (সেশন নেই), তবে লগইন করবে
        if (!data || data.total_delivered === undefined) {
            await page.goto('https://steadfast.com.bd/login', { waitUntil: 'domcontentloaded' });
            await page.type('input[name="email"]', email);
            await page.type('input[name="password"]', password);
            
            await Promise.all([
                page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
                page.click('button[type="submit"]')
            ]);

            // লগইন শেষে আবার ডেটা পেজে হিট
            await page.goto(`https://steadfast.com.bd/user/consignment/getbyphone/${phone}`, { waitUntil: 'domcontentloaded' });
            rawData = await page.evaluate(() => document.body.innerText);
            data = JSON.parse(rawData);
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
        
        return res.status(400).json({ error: "Invalid Data Format" });

    } catch (error) {
        if (page) await page.close();
        return res.status(500).json({ error: "Bypass Failed: " + error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Smart Bypasser running on port ${PORT}`));
