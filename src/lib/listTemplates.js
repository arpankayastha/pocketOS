// Starter content for new lists and occasions. Generic on purpose (nothing about any family): the owner edits
// everything after creating. `tasks` have `days` = days before the event date they're due; `samagri` and `people`
// are grouped by `section`.
export const LIST_PRESETS = [
  { id: 'groceries', name: 'Groceries', icon: '🛒', sections: ['Veg', 'Dairy', 'Dry & oil', 'Other'] },
  { id: 'shopping', name: 'Shopping', icon: '🛍️', sections: [] },
  { id: 'medicines', name: 'Medicines', icon: '💊', sections: [] },
  { id: 'todo', name: 'Home to-do', icon: '🏠', sections: [] },
  { id: 'blank', name: '', icon: '📝', sections: [] },
]

export const ICONS = ['🛒', '🛍️', '💊', '🏠', '📝', '🧺', '🎁', '✈️', '🍽️', '🪔', '🙏', '🎂', '💍', '📦']

export const EVENT_TEMPLATES = [
  {
    id: 'griha', name: 'Griha pravesh', icon: '🪔',
    tasks: [['Fix the muhurat with pandit ji', 30], ['Book pandit ji', 28], ['Make the invite list', 21], ['Send invitations', 14], ['Order sweets and prasad', 5],
      ['Deep clean the house', 4], ['Arrange flowers and decoration', 2], ['Set up the puja area', 1], ['Confirm the cook / caterer', 2]],
    samagri: [['Puja', 'Kumkum and haldi', '1 set'], ['Puja', 'Rice (akshat)', '1 kg'], ['Puja', 'Supari and paan leaves', ''], ['Puja', 'Coconuts', '5'], ['Puja', 'Ghee and camphor', ''],
      ['Puja', 'Incense and diya', ''], ['Kalash', 'Kalash and mango leaves', ''], ['Kalash', 'Gangajal', ''], ['Hawan', 'Hawan samagri and wood', ''],
      ['Decor', 'Flowers and garlands', ''], ['Decor', 'Toran', '2'], ['Decor', 'Rangoli colours', ''], ['Kitchen', 'New vessel and milk to boil', '']],
    people: [['Family', 'Close family'], ['Friends', 'Friends and neighbours'], ['Helpers', 'Pandit ji'], ['Helpers', 'Cook / caterer']],
  },
  {
    id: 'katha', name: 'Satyanarayan katha', icon: '🙏',
    tasks: [['Book pandit ji', 14], ['Invite family and friends', 7], ['Order prasad ingredients', 3], ['Clean and set up the puja space', 1]],
    samagri: [['Puja', 'Idol / photo and chowki', ''], ['Puja', 'Kumkum, haldi, chandan', ''], ['Puja', 'Flowers and tulsi', ''], ['Puja', 'Banana leaves / plantain', ''],
      ['Prasad', 'Wheat flour, ghee, sugar', ''], ['Prasad', 'Banana and fruits', ''], ['Prasad', 'Panchamrit (milk, curd, honey, ghee, sugar)', '']],
    people: [['Family', 'Family'], ['Friends', 'Friends']],
  },
  {
    id: 'moving', name: 'Moving out', icon: '📦',
    tasks: [['Book the movers', 21], ['Start packing, room by room', 14], ['Change address (bank, Aadhaar, gas, post)', 10], ['Transfer electricity / water / internet', 7],
      ['Hand over the keys', 0]],
    samagri: [['Packing', 'Cartons', '20'], ['Packing', 'Tape and markers', ''], ['Packing', 'Bubble wrap and newspaper', '']],
    people: [['Helpers', 'Movers']],
  },
  {
    id: 'wedding', name: 'Wedding', icon: '💍',
    tasks: [['Fix the venue and date', 120], ['Book the caterer', 90], ['Book the decorator', 90], ['Send invitations', 45], ['Final guest count to caterer', 7]],
    samagri: [['Rituals', 'Puja items', ''], ['Gifts', 'Return gifts', '']],
    people: [['Family', 'Family'], ['Friends', 'Friends'], ['Helpers', 'Caterer'], ['Helpers', 'Decorator']],
  },
  {
    id: 'birthday', name: 'Birthday', icon: '🎂',
    tasks: [['Make the guest list', 14], ['Order the cake', 5], ['Arrange decoration', 2]],
    samagri: [['Party', 'Balloons', ''], ['Party', 'Candles', ''], ['Party', 'Return gifts', '']],
    people: [['Family', 'Family'], ['Friends', 'Friends']],
  },
  { id: 'blank', name: '', icon: '🪔', tasks: [], samagri: [], people: [] },
]

export const OCCASION_TABS = [
  { id: 'tasks', label: 'Tasks', icon: '✅' },
  { id: 'samagri', label: 'Samagri', icon: '🧺' },
  { id: 'people', label: 'People', icon: '👥' },
  { id: 'money', label: 'Money', icon: '💰' },
]
