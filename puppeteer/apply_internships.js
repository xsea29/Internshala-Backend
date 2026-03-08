const puppeteer = require("puppeteer-extra");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const email = process.env.EMAIL;
const password = process.env.PASSWORD;

// Create directories for organized storage
const DATA_DIR = path.join(__dirname, "..", "data");
const SESSIONS_DIR = path.join(__dirname, "..", "sessions");
const AUTH_DIR = path.join(__dirname, "..", "auth");

[DATA_DIR, SESSIONS_DIR, AUTH_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

let profile, cover, sessionId;

if (process.argv[2]) {
  try {
    const data = JSON.parse(process.argv[2]);
    profile = data.profile;
    cover = data.cover;
  } catch (error) {
    console.error("Error parsing JSON from arguments:", error.message);
    process.exit(1);
  }
} else {
  console.error("Error: No profile and cover data provided");
  process.exit(1);
}

// Get session ID from 3rd argument
if (process.argv[3]) {
  sessionId = process.argv[3];
} else {
  console.error("Error: No session ID provided");
  process.exit(1);
}

// Debugging output
console.log("Parsed Data:", { profile, cover, sessionId });
// const data = JSON.parse(args);
// const { profile, cover } = data;

// Progress tracking with session-based file in sessions directory
const progressFile = path.join(SESSIONS_DIR, `progress_${sessionId}.json`);
const cookiesFile = path.join(AUTH_DIR, "cookies.json");
const resultCSV = path.join(DATA_DIR, "result.csv");
const successCSV = path.join(DATA_DIR, "successful_applications.csv");

function updateProgress(progress, status, applied = 0, total = 0) {
  const progressData = {
    progress,
    status,
    applied,
    total,
    timestamp: Date.now()
  };
  fs.writeFileSync(progressFile, JSON.stringify(progressData));
  console.log(`Progress: ${progress}% - ${status}`);
}

// Check if stop signal received
function shouldStop() {
  try {
    if (fs.existsSync(progressFile)) {
      const data = JSON.parse(fs.readFileSync(progressFile, 'utf8'));
      return data.stop === true;
    }
  } catch (error) {
    // Ignore errors
  }
  return false;
}

(async () => {
  updateProgress(5, "Launching browser...", 0, 0);
  
  const browser = await puppeteer.launch({
    headless: "new",
    executablePath:
      process.env.PUPPETEER_EXECUTABLE_PATH ||
      require("puppeteer").executablePath(),
    defaultViewport: null,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      "--disable-software-rasterizer",
      "--disable-extensions"
    ],
  });

  const page = await browser.newPage();

  updateProgress(10, "Logging into Internshala...", 0, 0);
  
  if (fs.existsSync(cookiesFile)) {
    await loadCookies(page);
  } else {
    await loginAndSaveCookies(page);
  }

  updateProgress(20, "Navigating to internships page...", 0, 0);
  await navigateToInternships(page);
  
  updateProgress(25, "Setting profile filter...", 0, 0);
  await setProfileFilter(page, profile);
  await page.waitForSelector(".internship_list_container");

  updateProgress(30, "Fetching matching internships...", 0, 0);
  // const applications = await fetchApplications(page, profile);
  await fetchApplications(page, profile);

  const totalApplications = allApplications.length;
  console.log(
    `Found ${totalApplications} allApplications matching profile.`
  );
  
  updateProgress(40, `Found ${totalApplications} matching internships`, 0, totalApplications);

  for (let i = 0; i < allApplications.length; i++) {
    // Check if stop signal received
    if (shouldStop()) {
      console.log("Stop signal received. Exiting...");
      updateProgress(
        Math.round(40 + ((i) / totalApplications) * 55),
        "Stopped by user",
        i,
        totalApplications
      );
      await browser.close();
      process.exit(0);
    }
    
    const application = allApplications[i];
    const progressPercent = 40 + ((i + 1) / totalApplications) * 55;
    updateProgress(
      Math.round(progressPercent),
      `Applying to ${application.title}...`,
      i + 1,
      totalApplications
    );
    
    await applyForInternship(
      page,
      application.url,
      application.title,
      application.company
    );
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  updateProgress(95, "Closing browser...", totalApplications, totalApplications);
  await browser.close();
  
  // Mark as complete
  const finalData = {
    progress: 100,
    status: "Applications completed!",
    applied: totalApplications,
    total: totalApplications,
    complete: true,
    timestamp: Date.now()
  };
  fs.writeFileSync(progressFile, JSON.stringify(finalData));
  console.log("Progress: 100% - Applications completed!");
})();

async function loadCookies(page) {
  const storedCookies = fs.readFileSync(cookiesFile);
  const cookies = JSON.parse(storedCookies);
  await page.setCookie(...cookies);
  console.log("Cookies loaded successfully!");
  await page.goto("http://www.internshala.com", { 
    waitUntil: "networkidle2", 
    timeout: 60000 // 60 seconds timeout
  });
  await new Promise((resolve) => setTimeout(resolve, 1000));
}

async function loginAndSaveCookies(page) {
  try {
    console.log("Login credentials check - Email:", email ? "SET" : "MISSING", "Password:", password ? "SET" : "MISSING");
    
    await page.goto("http://www.internshala.com", { 
      waitUntil: "networkidle2", 
      timeout: 60000 // 60 seconds timeout
    });
    console.log("Loaded Internshala homepage");
    await new Promise((resolve) => setTimeout(resolve, 1000));
    
    await page.waitForSelector(".register-student-cta", { visible: true, timeout: 30000 });
    await page.click(".register-student-cta");
    console.log("Clicked register button");
    
    await page.waitForSelector("#login-link-container", { visible: true, timeout: 30000 });
    await new Promise((resolve) => setTimeout(resolve, 500));
    await page.click('[data-target="#login-modal"]');
    console.log("Opened login modal");

    // Wait for modal to appear
    await page.waitForSelector("#modal_email", { visible: true, timeout: 30000 });
    await new Promise((resolve) => setTimeout(resolve, 800));
    
    console.log("Typing credentials...");
    await page.type("#modal_email", email, { delay: 100 });
    await page.type("#modal_password", password, { delay: 100 });
    await page.keyboard.press("Enter");
    console.log("Submitted login form");
    
    await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 60000 });
    console.log("Login successful");

    const cookies = await page.cookies();
    fs.writeFileSync(cookiesFile, JSON.stringify(cookies));
    console.log("Cookies saved successfully!");
  } catch (error) {
    console.error("Login error:", error.message);
    updateProgress(10, `Login failed: ${error.message}`, 0, 0);
    throw error;
  }
}

async function navigateToInternships(page) {
  await page.waitForSelector("#internships_new_superscript", { visible: true });
  await new Promise((resolve) => setTimeout(resolve, 800));
  
  // Use Promise.all to handle click and navigation together
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle2", timeout: 60000 }),
    page.click("#internships_new_superscript")
  ]);
  
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
      fs.appendFileSync(resultCSV, csvData);
      console.log("Saved:", csvData);
    });

    applications = []; //Empty the applications for no redundancy

    // Check for "Next Page" button
    const nextPageElement = await page.$(".next_page");

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
      await new Promise((resolve) => setTimeout(resolve, 800));
      
      // Use Promise.all to handle click and navigation together
      try {
        await Promise.all([
          page.waitForNavigation({ waitUntil: "networkidle2", timeout: 60000 }),
          nextPageElement.click()
        ]);
      } catch (error) {
        console.log("Navigation error, retrying...");
        await page.reload({ waitUntil: "networkidle2" });
      }
      
      await page.waitForSelector(".internship_list_container", {
        visible: true,
        timeout: 30000
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
    await page.goto(`https://internshala.com${url}`, { 
      waitUntil: "networkidle2",
      timeout: 60000 // 60 seconds timeout
    });
    console.log("Applying for:", url);

    // Wait for apply button to be visible and clickable
    await page.waitForSelector(".buttons_container", { visible: true, timeout: 30000 });
    await page.waitForSelector("button.btn.btn-large", { visible: true, timeout: 30000 });
    await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
    await page.click("button.btn.btn-large");

    // Wait for application form to load
    await new Promise(resolve => setTimeout(resolve, 1500)); // Wait 1.5 seconds
    
    const coverLetter = await page.$(".ql-editor.ql-blank");
    if (coverLetter) {
      await page.waitForSelector(".ql-editor.ql-blank", { visible: true, timeout: 30000 });
      await coverLetter.click(); // Focus on the element
      await new Promise(resolve => setTimeout(resolve, 500));
      await coverLetter.type(cover, { delay: 20 }); // Increased delay for safer typing
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    // Wait before checking relocation checkbox
    await new Promise(resolve => setTimeout(resolve, 800));
    const relocationCheckbox = await page.$(
      'input[name="location_single"][value="yes"]'
    );
    if (relocationCheckbox) {
      await new Promise(resolve => setTimeout(resolve, 500));
      await page.click('input[name="location_single"][value="yes"]');
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    // Wait before clicking submit button
    await new Promise(resolve => setTimeout(resolve, 1000));
    await page.waitForSelector("div.submit_button_container > #submit", { visible: true, timeout: 30000 });
    await page.click("div.submit_button_container > #submit");

    const isDisabled = await page.$eval(
      "div.submit_button_container > #submit",
      (btn) => btn.disabled
    );
    if (isDisabled) {
      const csvData = `${title}, ${company}\n`;
      fs.appendFile(successCSV, csvData, (err) => {
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
