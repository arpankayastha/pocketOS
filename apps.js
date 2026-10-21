// The apps shown on the page. Adding an app = one more object here (only name, url, status and about are required).
// status: 'live' | 'private' | 'building' | 'idea'
window.APPS = [
  {
    name: 'eChopdo',
    icon: 'icons/echopdo.svg',
    url: 'https://echopdo.vercel.app',
    status: 'private',
    about: 'A family money, records and passwords app. Named after the chopdo, the family account book blessed every Diwali.',
    problem: 'Household money lived in notebooks, bank SMS and memory. Nobody could say what was left to spend this month or which bills were still due.',
    features: [
      'Daily cash book and a monthly plan: what came in, what went out, what is left to spend',
      'Android companion app reads bank SMS on the phone and adds the entry automatically; a home-screen widget adds one by hand in two taps',
      'Dues between people, loans with EMI schedules and prepayment what-ifs, credit-card bill cycles',
      'Zero-knowledge password vault: encrypted on the device, unlocked by fingerprint',
      'Separate logins per household, weekly encrypted backup to Google Drive',
    ],
    stack: ['React', 'Supabase · Postgres RLS', 'Edge Functions', 'Kotlin Android', 'WebAuthn', 'Web Crypto'],
    platforms: ['Web app (PWA)', 'Android'],
  },
  {
    name: 'GRANDXGAMER',
    icon: 'icons/grandxgamer.png',
    url: 'https://grandxgamer.vercel.app',
    status: 'live',
    about: 'Runs a gaming café end to end: the counter, the cash, the staff and the customers.',
    problem: 'The café ran on Excel and a notebook: PC and PS5 time, cash and staff hours were hard to keep straight.',
    features: [
      'Customers: a public home page, event pages and online slot booking',
      'Counter: live PC and PS5 sessions with timers, food and drinks, extend and end the bill',
      'Cash drawer and a daily check that every bill adds up',
      'Staff: PIN logins, clock-in shifts, hourly pay and salary paid',
      'Shop-phone app that matches bank SMS payments to bills',
    ],
    stack: ['React', 'Supabase · Postgres RLS', 'Kotlin Android'],
    platforms: ['Web app (PWA)', 'Android'],
  },
];
