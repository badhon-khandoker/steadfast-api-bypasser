const express = require('express');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const app = express();
app.use(express.json());

let globalBrowser = null;
let cachedCookies = null;

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

        // ইমেজ এবং CSS ব্লক করা
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            if (['image', 'stylesheet', 'font', 'media'].includes(req.resourceType())) {
                req.abort();
            } else {
                req.continue();
            }
        });

        if (cachedCookies) {
            // BUG FIX: partitionKey মুছে ফেলা হচ্ছে যাতে Puppeteer ক্র্যাশ না করে
            const cleanCookies = cachedCookies.map(cookie => {
                const { partitionKey, size, priority, sourceScheme, sourcePort, ...rest } = cookie;
                return rest;
            });
            await page.setCookie(...cleanCookies);
            
            await page.goto(`https://steadfast.com.bd/user/consignment/getbyphone/${phone}`, { waitUntil: 'domcontentloaded' });
            
            if (page.url().includes('/login')) {
                cachedCookies = null;
            }
        }

        if (!cachedCookies) {
            await page.goto('https://steadfast.com.bd/login', { waitUntil: 'domcontentloaded' });
            await page.type('input[name="email"]', email);
            await page.type('input[name="password"]', password);
            
            await Promise.all([
                page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
                page.click('button[type="submit"]')
            ]);

            cachedCookies = await page.cookies();
            await page.goto(`https://steadfast.com.bd/user/consignment/getbyphone/${phone}`, { waitUntil: 'domcontentloaded' });
        }

        const rawData = await page.evaluate(() => document.querySelector("body").innerText);
        const data = JSON.parse(rawData);

        await page.close();

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
        cachedCookies = null;
        return res.status(500).json({ error: "Bypass Failed: " + error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Super Fast Bypasser running on port ${PORT}`));
