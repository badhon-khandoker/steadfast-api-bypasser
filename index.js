const express = require('express');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const app = express();
app.use(express.json());

app.post('/api/steadfast', async (req, res) => {
    const { phone, email, password } = req.body;
    if(!phone || !email || !password) {
        return res.status(400).json({ error: "Missing credentials or phone" });
    }

    let browser = null;
    try {
        // একদম বেসিক এবং স্ট্যাবল ব্রাউজার লঞ্চ
        browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
        });
        
        const page = await browser.newPage();
        
        // লগইন পেজে যাওয়া
        await page.goto('https://steadfast.com.bd/login', { waitUntil: 'networkidle2' });
        
        // ইমেইল ও পাসওয়ার্ড বসানো
        await page.type('input[name="email"]', email);
        await page.type('input[name="password"]', password);
        
        // সাবমিট এবং নেভিগেশন
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'networkidle2' }),
            page.click('button[type="submit"]')
        ]);

        // সরাসরি ডেটা API-তে হিট
        await page.goto(`https://steadfast.com.bd/user/consignment/getbyphone/${phone}`, { waitUntil: 'networkidle2' });
        
        // ডেটা রিড করা
        const data = await page.evaluate(() => {
            return JSON.parse(document.querySelector("body").innerText);
        });

        await browser.close();

        // রেশিও ক্যালকুলেট করা
        if(data && data.total_delivered !== undefined) {
            const success = parseInt(data.total_delivered);
            const cancelled = parseInt(data.total_cancelled || 0);
            const total = success + cancelled;
            const ratio = (total > 0) ? Math.round((success / total) * 100) : 100;
            
            return res.json({ total, ratio, status: "success" });
        }
        return res.status(400).json({ error: "Invalid Data from Steadfast" });

    } catch (error) {
        if(browser) await browser.close();
        return res.status(500).json({ error: "Bypass Failed: " + error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Stable Bypasser running on port ${PORT}`));
