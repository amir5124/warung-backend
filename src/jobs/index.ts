import { startReminderJob } from './reminder.job';
import { startOrderTimeoutJob } from './orderTimeout.job';
import { logger } from '../config/logger';

export const startJobs = () => {
    startReminderJob();
    startOrderTimeoutJob();
    logger.info('Cron jobs started');
};