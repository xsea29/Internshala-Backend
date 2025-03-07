const puppeteer = require("puppeteer-extra");
const fs = require("fs");
require("dotenv").config();

const email = process.env.EMAIL;
const password = process.env.PASSWORD;

const jsonData = process.env.JSON_DATA;
let profile, cover;

if (process.argv[2]) {
  try {
    const data = JSON.parse(process.argv[2]);
    profile = data.profile;
    cover = data.cover;
  } catch (error) {
    console.error("Error parsing JSON from arguments:", error.message);
    process.exit(1);
  }
} else if (jsonData) {
  try {
    const data = JSON.parse(jsonData);
    profile = data.profile;
    cover = data.cover;
  } catch (error) {
    console.error(
      "Error parsing JSON from environment variable:",
      error.message
    );
    process.exit(1);
  }
} else {
  console.error("Error: No JSON data provided");
  process.exit(1);
}

// Debugging output
console.log("Parsed Data:", { profile, cover });
// const data = JSON.parse(args);
// const { profile, cover } = data;

(async () => {
  const browser = await puppeteer.launch({
    headless: "true",
    executablePath: "/usr/bin/chromium",
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
  await setProfileFilter(page, profile);
  await page.waitForSelector(".internship_list_container");

  // const applications = await fetchApplications(page, profile);
  await fetchApplications(page, profile);

  console.log(
    `Found ${allApplications.length} allApplications matching profile.`
  );

  for (const application of allApplications) {
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

async function setProfileFilter(page, profile) {
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
}

let allApplications = [];

async function fetchApplications(page, profile) {
  let pageNum = 1;

  while (true) {
    console.log(`Scraping page ${pageNum}...`);

    // Extract applications from the current page
    let applications = await page.$$eval(
      '[data-source_cta="easy_apply"]',
      (elements, profile) =>
        elements
          .map((el) => {
            const title =
              el.querySelector("div > h3 > a")?.textContent.trim() || "Null";
            const company =
              el.querySelector("div > div > p")?.textContent.trim() || "Null";
            const url =
              el.querySelector(".job-title-href")?.getAttribute("href") ||
              "Null";

            return title.toLowerCase() === profile.toLowerCase()
              ? { title, company, url }
              : null;
          })
          .filter(Boolean),
      profile
    );

    // Store data globally
    allApplications.push(...applications);

    // Save applications to CSV
    applications.forEach(({ title, company, url }) => {
      const csvData = `${title}, ${company.trim()}, ${url}\n`;
      fs.appendFileSync("result.csv", csvData);
      console.log("Saved:", csvData);
    });

    applications = []; //Empty the applications for no redundancy

    // Check for "Next Page" button
    const nextPageElement = await page.$(".next_page > i");

    if (nextPageElement) {
      const isDisabled = await page.evaluate(
        (el) => el.classList.contains("disabled"),
        nextPageElement
      );

      if (isDisabled) {
        console.log("Reached last page. Stopping...");
        break;
      }

      // Click the button and wait for the next page
      await nextPageElement.click();
      await page.waitForSelector(".internship_list_container", {
        visible: true,
      });
      await new Promise((resolve) => setTimeout(resolve, 2000));

      pageNum++;
    } else {
      console.log("No 'Next Page' button found. Stopping...");
      break;
    }
  }
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

    const isDisabled = await page.$eval(
      "div.submit_button_container > #submit",
      (btn) => btn.disabled
    );
    if (isDisabled) {
      const csvData = `${title}, ${company}\n`;
      fs.appendFile("successful_applications.csv", csvData, (err) => {
        if (err) throw err;
        console.log("Saved successful application:", csvData);
      });
    } else {
      console.log("Application may not have been successful:", url);
    }

    await page.waitForSelector(
      ".message_container > .application_submit_success",
      { timeout: 5000 }
    );

    console.log("Successfully applied to:", url);
  } catch (error) {
    console.error("Error applying to:", url, error);
  }
}
