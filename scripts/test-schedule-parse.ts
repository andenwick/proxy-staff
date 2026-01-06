import 'dotenv/config';
import * as chrono from 'chrono-node';
import { parseSchedule } from '../src/services/scheduleParser.js';

const input = 'in 1 minute';
console.log('Input:', input);
console.log('Now:', new Date());

// Test chrono directly
const chronoParsed = chrono.parseDate(input);
console.log('Chrono parsed:', chronoParsed);

// Test our parser
const parsed = parseSchedule(input);
console.log('Our parser:', parsed);

// Check minimum time validation
if (parsed && parsed.runAt) {
  const minFutureTime = new Date(Date.now() + 1 * 60 * 1000);
  console.log('Min future time (1 min):', minFutureTime);
  console.log('Parsed runAt:', parsed.runAt);
  console.log('Is valid?', parsed.runAt >= minFutureTime);
}
