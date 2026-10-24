// Creates the monthly rent bills. Runs every night at 00:10 Nairobi time (21:10 UTC).
import type { Config } from '@netlify/functions';
import { dailyBills } from '../../backend/index';

export default async (): Promise<void> => {
    await dailyBills();
};

export const config: Config = { schedule: '10 21 * * *' };
