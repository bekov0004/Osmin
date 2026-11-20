// gjs -m src/utils/test/test_reminders.js
import * as R from '../reminders.js';
const ok = (c, what) => { if (!c) { print(`FAIL ${what}`); imports.system.exit(1); } };
const now = new Date(2026, 10, 20, 17, 0);       // Fri 20 Nov 17:00
const a = R.newReminder({time: '17:30', text: 'Call mom'}, now);
ok(a.date === '2026-11-20' && a.time === '17:30', 'once today');
ok(R.newReminder({time: '9:05', text: 'x'}, now).date === '2026-11-21', 'once tomorrow');
ok(!R.isDue(a, now) && R.isDue(a, new Date(2026, 10, 20, 17, 30)), 'due at its time');
const fired = R.rang(a, new Date(2026, 10, 20, 17, 30));
ok(!fired.enabled && !R.isDue(fired, new Date(2026, 10, 20, 17, 31)), 'once off after ringing');
const s = R.snoozed(fired, 10, new Date(2026, 10, 20, 17, 31));
ok(s.enabled && !R.isDue(s, new Date(2026, 10, 20, 17, 40)) && R.isDue(s, new Date(2026, 10, 20, 17, 41)), 'snooze 10 min');
const d = R.newReminder({time: '08:00', text: 'stand up', repeat: 'weekdays'}, now);
ok(R.nextRing(d, now).getDay() === 1, 'weekdays: next is Monday');
const daily = R.newReminder({time: '16:00', text: 'tea', repeat: 'daily'}, now);
ok(R.isDue(daily, now), 'daily missed an hour ago still rings');
const after = R.rang(daily, now);
ok(!R.isDue(after, new Date(2026, 10, 20, 17, 1)) && R.nextRing(after, now).getDate() === 21, 'daily: tomorrow after ringing');
ok(!R.isDue(daily, new Date(2026, 10, 20, 23, 30)), 'too late: not rung (more than 3 h)');
ok(R.parseTime('7.5') === null && R.parseTime('7:05') === '07:05' && R.parseTime('1830') === '18:30', 'time parsing');
ok(R.parseList('nonsense').length === 0 && R.parseList(JSON.stringify([a])).length === 1, 'list parsing');
print('reminders ok');
