import changelogText from '../../CHANGELOG.md?raw';
import { parseChangelog } from '../../shared/changelog';

export const releases = parseChangelog(changelogText);
export const runningVersion = Number(__APP_VERSION__) || 0;
