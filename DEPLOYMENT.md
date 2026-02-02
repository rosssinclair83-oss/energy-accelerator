# Deployment Guide: Energy Accelerator

This guide assumes you have no prior experience with hosting. We will break this down into three simple phases.

**The Concept**:
Most free website hosts (like Vercel) have a limit on file sizes (usually ~100MB). Your map data files (`.pmtiles`) are larger than this (~200MB+).
To fix this, we will put the **big files** in a dedicated storage locker (Cloudflare R2) and duplicate the **script code** to the website host (Vercel).

---

## Phase 1: Host the Map Data (Cloudflare R2)

Cloudflare R2 is like a hard drive on the internet. It is very cheap (generous free tier) and perfect for large files.

### 1. Create a Bucket
1.  Go to [Cloudflare](https://www.cloudflare.com/) and sign up for a free account.
2.  On the sidebar, click **R2**.
3.  Click **Create Bucket**.
4.  Name it `energy-map-data` (or similar).
5.  Click **Create Bucket**.

### 2. Upload Files
1.  Click on your new bucket name.
2.  Click **Upload**.
3.  Drag and drop these three files from your project's `public` folder:
    - `power.pmtiles`
    - `powerlabels.pmtiles`
    - `power_search_index.json`
4.  Wait for the upload to finish.

### 3. Make it Public
By default, files are private. We need the website to be able to read them.
1.  In your bucket, go to the **Settings** tab.
2.  Scroll down to **R2.dev Subdomain**.
3.  Click **Allow Access**.
4.  Copy the URL it gives you (e.g., `https://pub-12345.r2.dev`). **Save this for Phase 3!**

### 4. Enable CORS (Critical)
"CORS" is a security setting. We need to tell Cloudflare "It's okay if my website asks for these files."
1.  In your bucket **Settings** tab, scroll to **CORS Policy**.
2.  Click **Edit CORS Policy**.
3.  Paste this code:
    ```json
    [
      {
        "AllowedOrigins": ["*"],
        "AllowedMethods": ["GET"],
        "AllowedHeaders": ["*"]
      }
    ]
    ```
4.  Click **Save**.

---

## Phase 2: Prepare Your Code

I (the AI) will make these changes for you automatically once you approve the plan, but here is what happens:
1.  We tell the code: "Look for a variable called `VITE_DATA_BASE_URL`."
2.  If that variable exists, we load map tiles from *there*.
3.  If it doesn't exist (like on your laptop), we load them from the local folder.

---

## Phase 3: Host the Website (Vercel)

Vercel is the industry standard for hosting React apps.

### 1. Push to GitHub
Since you have already uploaded your large files to Cloudflare, we **do not** want to upload them to GitHub. The project has been configured (via `.gitignore`) to automatically skip these files.

**If this is your first time saving to GitHub, run these commands in your terminal:**

1.  Initialize the repository:
    ```powershell
    git init
    ```
2.  Add all files (the `.gitignore` will ensure the large pmtiles are skipped):
    ```powershell
    git add .
    ```
3.  Commit your changes:
    ```powershell
    git commit -m "Initial commit for deployment"
    ```
4.  Connect to GitHub (replace `<YOUR_REPO_URL>` with your actual new repository URL from GitHub):
    ```powershell
    git branch -M main
    git remote add origin <YOUR_REPO_URL>
    git push -u origin main
    ```

*Note: If `git status` shows `power.pmtiles`, do NOT commit yet. Check that `.gitignore` contains `*.pmtiles`.*

### 2. Create Project in Vercel
1.  Go to [Vercel](https://vercel.com/) and sign up (login with GitHub is easiest).
2.  Click **Add New...** -> **Project**.
3.  Find your `energy-accelerator-v4` repo and click **Import**.

### 3. Configure & Deploy
1.  On the configuration screen, look for **Environment Variables**.
2.  Click to expand it.
3.  Add a new variable:
    - **Key**: `VITE_DATA_BASE_URL`
    - **Value**: The URL you copied from Cloudflare in Phase 1 (e.g., `https://pub-12345.r2.dev`).
4.  Click **Deploy**.

Vercel will build your site. In about 2 minutes, it will give you a link (e.g., `energy-accelerator.vercel.app`). Click it, and your live site should work!
