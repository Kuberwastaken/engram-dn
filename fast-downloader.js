import axios from 'axios';
import fs from 'fs';
import path from 'path';

class FastDownloader {    constructor() {
        this.baseUrl = 'https://api.dotnotes.in';
        this.materialsDir = path.resolve('./material');
        
        // All branch IDs
        this.branches = {
            'AIDS': '1fH0uvhnXRsshqiDzHlR3WF2LVC7PfnQ7',
            'AIML': '13moTd7MZzBiAl-0xdUHEtF-xlV_OwlLz',
            'CIVIL': '1_OLVAfJQldM4F1F0QU9PBLL0gWXhnv66',
            'CSE': '12fczfGql33ZZH9LSFgxcrrOuIAKEzjdh',
            'ECE': '1Yo-MxG6locQ4lMKl07CN8lwqvnu-cWt3',
            'EEE': '1N-0kK34Qqme71MlznsslSE-RhiAaWRM1',
            'IT': '1u0nTa0WLf58jZ42zuLS7anUb7d_Nj99p',
            'MECH': '1XLxDgD7iJCbWZx7JbcuRDAfg2NPitVGV'
        };
          this.stats = {
            totalFiles: 2131, // From metadata
            downloadedFiles: 0,
            skippedFiles: 0,
            errorFiles: 0,
            errors: [],
            startTime: new Date().toISOString()
        };
        
        this.commonSemestersDownloaded = false;
    }

    async makeRequest(url, maxRetries = 3) {
        for (let i = 0; i < maxRetries; i++) {
            try {
                const response = await axios.get(url, { 
                    timeout: 15000,
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'                    }
                });
                await new Promise(resolve => setTimeout(resolve, 50));
                return response.data;
            } catch (error) {
                if (i === maxRetries - 1) throw error;
                await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
            }
        }
    }

    async downloadFile(downloadUrl, filePath, fileName) {
        try {
            // Check if file already exists and has reasonable size
            if (fs.existsSync(filePath)) {
                const stats = fs.statSync(filePath);
                if (stats.size > 100) {
                    this.stats.skippedFiles++;
                    return true;
                }
            }

            const response = await axios.get(downloadUrl, {
                responseType: 'stream',
                timeout: 60000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            });

            fs.mkdirSync(path.dirname(filePath), { recursive: true });

            const writer = fs.createWriteStream(filePath);
            response.data.pipe(writer);

            return new Promise((resolve, reject) => {
                writer.on('finish', () => {
                    const size = fs.statSync(filePath).size;
                    const sizeStr = this.formatFileSize(size);
                    console.log(`          ✅ ${fileName} (${sizeStr})`);
                    this.stats.downloadedFiles++;
                    this.printProgress();
                    resolve(true);
                });
                writer.on('error', reject);
            });
        } catch (error) {
            console.log(`          ❌ Failed ${fileName}: ${error.message}`);
            this.stats.errorFiles++;
            return false;
        }
    }

    formatFileSize(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    printProgress() {
        const total = this.stats.downloadedFiles + this.stats.skippedFiles;
        const percent = ((total / this.stats.totalFiles) * 100).toFixed(1);
        if (total % 10 === 0) { // Print every 10 files
            console.log(`   📊 Progress: ${total}/${this.stats.totalFiles} (${percent}%) | Downloaded: ${this.stats.downloadedFiles} | Skipped: ${this.stats.skippedFiles}`);
        }
    }

    sanitizeFileName(name) {
        return name
            .replace(/[<>:"/\\|?*]/g, '_')
            .replace(/\s+/g, '_')
            .substring(0, 200);
    }    async downloadAllFiles() {
        console.log('🚀 FAST DOWNLOADER STARTING...');
        console.log('📊 Expected total files: 2,131 (from metadata)\n');
        
        for (const [branchName, branchId] of Object.entries(this.branches)) {
            console.log(`\n🎯 PROCESSING ${branchName} BRANCH...`);
            
            try {
                const semesters = await this.makeRequest(`${this.baseUrl}/getChild?id=${branchId}`);
                console.log(`   📊 Found ${semesters.length} semesters`);
                
                for (const semester of semesters) {
                    const semName = semester.name.toUpperCase();
                    
                    // Download SEM1 and SEM2 to COMMON folder only once
                    if (semName === 'SEM1' || semName === 'SEM2') {
                        if (!this.commonSemestersDownloaded) {
                            console.log(`\n   📚 ${semName} (COMMON)...`);
                            await this.downloadSemesterFiles(semester, 'COMMON');
                        } else {
                            console.log(`   ⏭️  Skipping ${semName} (already in COMMON)`);
                        }
                        continue;
                    }
                    
                    console.log(`\n   📚 ${semName}...`);
                    await this.downloadSemesterFiles(semester, branchName);
                }
                
                // Mark common semesters as downloaded after first branch
                if (!this.commonSemestersDownloaded) {
                    this.commonSemestersDownloaded = true;
                }
                
                console.log(`\n✅ COMPLETED ${branchName}!`);
                
            } catch (error) {
                console.log(`   ❌ FAILED ${branchName}: ${error.message}`);
            }
        }
        
        this.generateReport();
    }

    async downloadSemesterFiles(semester, branchName) {
        try {
            const subjects = await this.makeRequest(`${this.baseUrl}/getChild?id=${semester.id}`);
            
            for (const subject of subjects) {
                console.log(`\n       📖 ${subject.name}`);
                
                const folders = await this.makeRequest(`${this.baseUrl}/getChild?id=${subject.id}`);
                
                for (const folder of folders) {
                    console.log(`         📁 ${folder.name}`);
                    
                    const files = await this.makeRequest(`${this.baseUrl}/getFiles?id=${folder.id}`);
                    
                    if (files.length === 0) continue;
                    
                    const folderPath = path.join(
                        this.materialsDir,
                        branchName,
                        semester.name.toUpperCase(),
                        subject.name,
                        folder.name
                    );
                    
                    for (const file of files) {
                        if (!file.url_download) continue;
                        
                        const sanitizedName = this.sanitizeFileName(file.name);
                        const filePath = path.join(folderPath, sanitizedName);                        await this.downloadFile(file.url_download, filePath, file.name);
                        await new Promise(resolve => setTimeout(resolve, 37));
                    }
                }
            }
        } catch (error) {
            console.log(`     ❌ Error in ${semester.name}: ${error.message}`);
        }
    }

    generateReport() {
        const total = this.stats.downloadedFiles + this.stats.skippedFiles;
        const percent = ((total / this.stats.totalFiles) * 100).toFixed(1);
        
        console.log('\n' + '='.repeat(60));
        console.log('🎉 DOWNLOAD COMPLETED!');
        console.log('='.repeat(60));
        console.log(`✅ Downloaded: ${this.stats.downloadedFiles} files`);
        console.log(`⏭️  Skipped: ${this.stats.skippedFiles} files`);
        console.log(`❌ Errors: ${this.stats.errorFiles} files`);
        console.log(`📊 Total processed: ${total}/${this.stats.totalFiles} (${percent}%)`);
        
        if (this.stats.errorFiles > 0) {
            console.log(`\n⚠️  ${this.stats.errors.length} errors occurred during download`);
        }
    }
}

// Run the fast downloader
const downloader = new FastDownloader();
downloader.downloadAllFiles().catch(error => {
    console.error('💥 ERROR:', error);
    process.exit(1);
});
