const puppeteer = require("puppeteer-extra");
const fs = require("fs");
require("dotenv").config();

const email = process.env.EMAIL;
const password = process.env.PASSWORD;

const args = process.argv[2];
const data = JSON.parse(args);
const { profile, cover } = data;

(async () => {
  const browser = await puppeteer.launch({
    headless: false,
    executablePath:
      process.env.PUPPETEER_EXECUTABLE_PATH || "/usr/bin/chromium-browser",
    defaultViewport: null,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu"],
  });

  const page = await browser.newPage();

  if (fs.existsSync("cookies.json")) {
    await loadCookies(page);
  } else {
    await loginAndSaveCookies(page);
  }

  await navigateToInternships(page);
  const applications = await fetchApplications(page, profile);

  console.log(`Found ${applications.length} applications matching profile.`);

  for (const application of applications) {
    await applyForInternship(
      page,
      application.url,
      application.title,
      application.company
    );
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  await browser.close();
})();

async function loadCookies(page) {
  const storedCookies = fs.readFileSync("cookies.json");
  const cookies = JSON.parse(storedCookies);
  await page.setCookie(...cookies);
  console.log("Cookies loaded successfully!");
  await page.goto("http://www.internshala.com", { waitUntil: "load" });
}

async function loginAndSaveCookies(page) {
  await page.goto("http://www.internshala.com", { waitUntil: "load" });
  await page.click(".register-student-cta");
  await page.waitForSelector("#login-link-container", { visible: true });
  await page.click('[data-target="#login-modal"]');

  await page.type("#modal_email", email, { delay: 100 });
  await page.type("#modal_password", password, { delay: 100 });
  await page.keyboard.press("Enter");
  await page.waitForNavigation();

  const cookies = await page.cookies();
  fs.writeFileSync("cookies.json", JSON.stringify(cookies));
  console.log("Cookies saved successfully!");
}

async function navigateToInternships(page) {
  await page.waitForSelector("#internships_new_superscript", { visible: true });
  await page.click("#internships_new_superscript");
  await new Promise((resolve) => setTimeout(resolve, 2000));
}

async function fetchApplications(page, profile) {
  await page.waitForSelector('[name="matching_preference"]');

  // Check the current state of the checkbox
  const isChecked = await page.$eval(
    '[name="matching_preference"]',
    (checkbox) => checkbox.checked
  );

  if (isChecked) {
    await page.click("#matching_preference");
  }

  await page.waitForSelector("#select_category_chosen > ul > li > input");
  await new Promise((resolve) => setTimeout(resolve, 1000));

  const searchElement = await page.$(
    "#select_category_chosen > ul > li > input",
    { visible: true }
  );
  await searchElement.focus();
  await new Promise((resolve) => setTimeout(resolve, 1000));

  await page.type("#select_category_chosen > ul > li > input", profile, {
    delay: 200,
  });
  await new Promise((resolve) => setTimeout(resolve, 1000));

  await page.keyboard.press("Enter");
  await new Promise((resolve) => setTimeout(resolve, 2000));
  await page.waitForSelector(".internship_list_container");

  const applications = await page.$$eval(
    '[data-source_cta="easy_apply"]',
    (elements, profile) =>
      elements
        .map((el) => {
          const title = el.querySelector("div > h3 > a")?.textContent || "Null";
          const company =
            el.querySelector("div > div > p")?.textContent || "Null";
          const url =
            el.querySelector(".job-title-href")?.getAttribute("href") || "Null";

          return title.toLowerCase() === profile.toLowerCase()
            ? { title, company, url }
            : null;
        })
        .filter(Boolean),
    profile
  );

  //Move to the Next Page
  // const nextButton = await page.$(".next_page > i");

  // if (nextButton) {
  //   await page.click(nextButton);
  //   await page.waitForSelector(".next_page > i", { visible: true });
  //   await new Promise((resolve) => setTimeout(resolve, 1000));
  // }

  applications.forEach(({ title, company, url }) => {
    const csvData = `${title}, ${company.trim()}, ${url}\n`;
    fs.appendFile("result.csv", csvData, (err) => {
      if (err) throw err;
      console.log("Saved:", csvData);
    });
  });

  return applications;
}

async function applyForInternship(page, url, title, company) {
  try {
    await page.goto(`https://internshala.com${url}`, { waitUntil: "load" });
    console.log("Applying for:", url);

    await page.waitForSelector(".buttons_container", { visible: true });
    await page.click("button.btn.btn-large");

    const coverLetter = await page.$(".ql-editor.ql-blank");
    if (coverLetter) {
      await coverLetter.type(cover, { delay: 10 });
    }

    const relocationCheckbox = await page.$(
      'input[name="location_single"][value="yes"]'
    );
    if (relocationCheckbox) {
      await page.click('input[name="location_single"][value="yes"]');
    }

    await page.click("div.submit_button_container > #submit");

    await page.waitForSelector(".message_container", { timeout: 5000 });

    console.log("Successfully applied to:", url);

    const messageContainer = await page.$(".message_container > span");

    if (messageContainer) {
      // const jobTitle = await page.$eval(
      //   "h1.profile_heading",
      //   (el) => el.innerText
      // );
      // const companyName = await page.$eval(
      //   "h2.company_name",
      //   (el) => el.innerText
      // );

      const csvData = `${title}, ${company}, ${url}\n`;
      fs.appendFile("successful_applications.csv", csvData, (err) => {
        if (err) throw err;
        console.log("Saved successful application:", csvData);
      });
    } else {
      console.log("Application may not have been successful:", url);
    }
  } catch (error) {
    console.error("Error applying to:", url, error);
  }
}

// Schedule to run at 9:00 AM every day
// schedule.scheduleJob("0 9 * * *", () => {
//   console.log("Running Puppeteer script...");
//   runPuppeteerScript();
// });
