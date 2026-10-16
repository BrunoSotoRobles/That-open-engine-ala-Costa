interface VersionCheckResult {
    status: 'current' | 'outdated' | 'error';
    message: string;
    newVersion?: string;
}

export class DatabaseVersionChecker {
    private static instance: DatabaseVersionChecker;
    private currentVersion: string = '1.01.005';
    private lastCheckDate?: Date;
    private localDataUrl: string = '/LCAAPP/data/co2data_construction.json';

    private constructor() {
        console.log('[DatabaseVersionChecker] Initializing with version:', this.currentVersion);
    }

    public static getInstance(): DatabaseVersionChecker {
        if (!DatabaseVersionChecker.instance) {
            console.log('[DatabaseVersionChecker] Creating new instance');
            DatabaseVersionChecker.instance = new DatabaseVersionChecker();
        }
        return DatabaseVersionChecker.instance;
    }

    public async checkVersion(): Promise<VersionCheckResult> {
        console.log('[DatabaseVersionChecker] Starting version check');
        try {
            console.log('[DatabaseVersionChecker] Fetching from local data...');
            const response = await fetch(this.localDataUrl);
            
            if (!response.ok) {
                console.error('[DatabaseVersionChecker] Local fetch failed:', response.status, response.statusText);
                return {
                    status: 'error',
                    message: 'Unable to check database version. Please try again later.'
                };
            }

            const data = await response.json();
            this.lastCheckDate = new Date();

            return {
                status: 'current',
                message: `Database is up to date (Version ${this.currentVersion}, Source: CO2data.fi construction materials database)`
            };

        } catch (error) {
            console.error('[DatabaseVersionChecker] Error during version check:', error);
            return {
                status: 'error',
                message: 'Error checking database version'
            };
        }
    }

    public getLastCheckDate(): Date | undefined {
        return this.lastCheckDate;
    }

    public getCurrentVersion(): string {
        return this.currentVersion;
    }
} 