import { dashboard } from './dashboard.js';
import { deathsScreen } from './deaths.js';
import { importScreen } from './import.js';
import { learnScreen } from './learn.js';
import { mapsScreen, metaScreen } from './meta.js';
import { progressScreen } from './progress.js';
import { reportsScreen } from './reports.js';
import { settingsScreen } from './settings.js';
import { trainingScreen } from './training.js';

export const screens = {
  dashboard,
  importMatch: importScreen,
  reports: reportsScreen,
  progress: progressScreen,
  deaths: deathsScreen,
  meta: metaScreen,
  maps: mapsScreen,
  learn: learnScreen,
  practice: trainingScreen,
  settings: settingsScreen,
};
