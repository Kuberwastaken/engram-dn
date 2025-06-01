# ENGRAM-EXP Fast Downloader

This repository contains an automated downloader that fetches educational materials and stores them directly in the GitHub repository using GitHub Actions. 

## Features

- **Automated Downloads**: Downloads 2,131+ educational files across multiple branches (AIDS, AIML, CIVIL, CSE, ECE, EEE, IT, MECH)
- **Smart Resume**: Automatically skips already downloaded files and resumes where it left off
- **GitHub Actions Integration**: Runs automatically in the cloud with no local setup required
- **Progress Tracking**: Detailed logging and progress reports
- **Error Handling**: Robust retry mechanisms and error reporting

## Setup Instructions

### 1. Repository Permissions
Make sure your repository has the correct permissions:

1. Go to your repository **Settings**
2. Navigate to **Actions** → **General**
3. Under "Workflow permissions", select:
   - ✅ **Read and write permissions**
   - ✅ **Allow GitHub Actions to create and approve pull requests**

### 2. Running the Downloader

#### Manual Trigger (Recommended for first run)
1. Go to the **Actions** tab in your repository
2. Click on "Download Materials" workflow
3. Click **Run workflow** button
4. Click the green **Run workflow** button

#### Automatic Schedule
The workflow is set to run automatically every Sunday at 2 AM UTC. You can modify this schedule in `.github/workflows/download-materials.yml`.

### 3. Monitoring Progress

- **Live Progress**: Check the Actions tab for real-time logs
- **Summary**: Each run generates a summary with download statistics
- **Artifacts**: Downloaded files are also uploaded as artifacts (backup)

## File Structure

After running, your repository will have this structure:
```
├── material/
│   ├── AIDS/
│   ├── AIML/
│   ├── CIVIL/
│   ├── COMMON/        # SEM1 & SEM2 (shared across branches)
│   ├── CSE/
│   ├── ECE/
│   ├── EEE/
│   ├── IT/
│   └── MECH/
├── fast-downloader.js
├── package.json
└── .github/workflows/download-materials.yml
```

## Technical Details

- **Runtime**: Ubuntu latest with Node.js 18
- **Timeout**: 6 hours maximum per run
- **Dependencies**: Axios for HTTP requests
- **File Types**: PDFs, JSONs, and other educational materials
- **Total Expected Files**: ~2,131 files
- **Resume Capability**: Automatically skips existing files based on file size validation

## Troubleshooting GitHub Actions Issues

### Issue: "No material directory found"
This usually indicates the download script failed to start or encountered an early error:

**Solution Steps:**
1. Check the "Run fast downloader" step logs for specific error messages
2. Verify repository permissions (Settings → Actions → General → Read/write permissions)
3. Ensure `package.json` and `fast-downloader.js` are in the repository root
4. Try running the workflow again (the script has built-in resume capability)

### Issue: Action fails with permission errors
**Solution:**
- Go to repository Settings → Actions → General
- Under "Workflow permissions", select "Read and write permissions"
- Enable "Allow GitHub Actions to create and approve pull requests"

### Issue: Download timeout (6 hours)
**Solution:**
- This is normal for the first run due to the large number of files
- Simply run the workflow again - the script will automatically resume where it left off
- Monitor progress via the debug output to see how many files are being processed

### Issue: API rate limiting or connection errors
**Solution:**
- The script has built-in retry mechanisms with exponential backoff
- Wait a few minutes and run the workflow again
- Check if the dotnotes.in API is accessible

### Issue: Repository size limit warnings
**Solution:**
- GitHub has a soft limit of 1GB for repositories
- Monitor repository size in Settings → General
- Consider using Git LFS for large files if needed
- The artifact backup provides an alternative download method

## Troubleshooting

### Action Fails with Permission Error
- Ensure repository has read/write permissions for Actions
- Check that the workflow has access to push commits

### Download Timeout
- The workflow has a 6-hour timeout
- Large downloads may need multiple runs (resume functionality handles this)

### Missing Files
- The script automatically resumes and downloads missing files
- Check the action logs for specific error messages

### Storage Limits
- GitHub repositories have a soft limit of 1GB
- Monitor repository size in Settings → General

## Customization

### Modify Download Schedule
Edit `.github/workflows/download-materials.yml`:
```yaml
schedule:
  - cron: '0 2 * * 0'  # Every Sunday at 2 AM UTC
```

### Add More Branches
Edit `fast-downloader.js` and add to the `branches` object:
```javascript
this.branches = {
    'NEW_BRANCH': 'your-branch-id-here',
    // ... existing branches
};
```

### Change File Filters
Modify the `downloadSemesterFiles` method to filter specific file types or folders.

## License

MIT License - Feel free to modify and distribute.
