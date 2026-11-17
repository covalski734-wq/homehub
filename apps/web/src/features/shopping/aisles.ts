import { t } from '@/i18n';

export type Aisle =
  | 'produce'
  | 'dairy'
  | 'bakery'
  | 'meat'
  | 'grocery'
  | 'frozen'
  | 'drinks'
  | 'household'
  | 'care'
  | 'pets'
  | 'other';

/** Store sections in walking order: the list reads top to bottom like a trip through the store. */
export const AISLES: { id: Aisle; label: string; emoji: string; words: string[] }[] = [
  {
    id: 'produce',
    label: t('shopping.aisles.produce'),
    emoji: '🥦',
    words: [
      'яблок',
      'банан',
      'апельсин',
      'лимон',
      'груш',
      'виноград',
      'ягод',
      'клубник',
      'картош',
      'картоф',
      'морков',
      'лук',
      'чеснок',
      'помидор',
      'томат',
      'огур',
      'перец',
      'капуст',
      'салат',
      'зелен',
      'укроп',
      'петруш',
      'кабач',
      'баклаж',
      'авокадо',
      'гриб',
      'шпинат',
      'брокол',
      'свекл',
      'фрукт',
      'овощ',
      'мандарин',
      'киви',
    ],
  },
  {
    id: 'dairy',
    label: t('shopping.aisles.dairy'),
    emoji: '🥛',
    words: [
      'молок',
      'кефир',
      'йогурт',
      'сметан',
      'творог',
      'сыр',
      'масло слив',
      'сливк',
      'ряженк',
      'яйц',
      'яйко',
      'mleko',
      'ser',
      'jogurt',
    ],
  },
  {
    id: 'bakery',
    label: t('shopping.aisles.bakery'),
    emoji: '🍞',
    words: [
      'хлеб',
      'батон',
      'булк',
      'лаваш',
      'багет',
      'круассан',
      'тортил',
      'булоч',
      'chleb',
      'bułk',
    ],
  },
  {
    id: 'meat',
    label: t('shopping.aisles.meat'),
    emoji: '🍗',
    words: [
      'мяс',
      'куриц',
      'курин',
      'филе',
      'фарш',
      'говяд',
      'свин',
      'индейк',
      'колбас',
      'сосиск',
      'ветчин',
      'бекон',
      'рыб',
      'лосос',
      'семг',
      'тунец',
      'креветк',
      'кальмар',
    ],
  },
  {
    id: 'grocery',
    label: t('shopping.aisles.grocery'),
    emoji: '🍝',
    words: [
      'макарон',
      'паст',
      'рис',
      'греч',
      'овсян',
      'мук',
      'сахар',
      'соль',
      'перец мол',
      'масло подсол',
      'масло олив',
      'масл',
      'кетчуп',
      'майонез',
      'соус',
      'консерв',
      'фасол',
      'горох',
      'чай',
      'кофе',
      'какао',
      'специ',
      'хлопь',
      'мюсли',
      'печень',
      'шоколад',
      'конфет',
      'орех',
      'снек',
      'чипс',
      'мёд',
      'мед',
      'варень',
    ],
  },
  {
    id: 'frozen',
    label: t('shopping.aisles.frozen'),
    emoji: '🧊',
    words: ['морожен', 'пельмен', 'вареник', 'заморож', 'пицц', 'лёд', 'лед'],
  },
  {
    id: 'drinks',
    label: t('shopping.aisles.drinks'),
    emoji: '🧃',
    words: ['вод', 'сок', 'газиров', 'кола', 'пиво', 'вино', 'лимонад', 'морс', 'энергет', 'woda'],
  },
  {
    id: 'household',
    label: t('shopping.aisles.household'),
    emoji: '🧽',
    words: [
      'туалетн',
      'бумаг',
      'салфет',
      'полотен',
      'губк',
      'средств',
      'порош',
      'гель для стир',
      'кондиционер для',
      'таблетк для посуд',
      'мешк',
      'пакет',
      'фольг',
      'плёнк',
      'пленк',
      'батарейк',
      'лампоч',
      'отбелив',
      'моющ',
      'чистящ',
    ],
  },
  {
    id: 'care',
    label: t('shopping.aisles.care'),
    emoji: '🧴',
    words: [
      'шампун',
      'мыл',
      'зубная',
      'зубн',
      'паст зуб',
      'щётк',
      'щетк',
      'дезодор',
      'крем',
      'бритв',
      'прокладк',
      'тампон',
      'ватн',
      'пластыр',
      'таблет',
      'витамин',
      'лекарств',
      'аптек',
      'гель для душ',
      'бальзам',
    ],
  },
  {
    id: 'pets',
    label: t('shopping.aisles.pets'),
    emoji: '🐾',
    words: ['корм', 'наполнит', 'лоток', 'кошк', 'собак', 'вкусняш'],
  },
  { id: 'other', label: t('shopping.aisles.other'), emoji: '🛒', words: [] },
];

/**
 * The store section of an item: the longest matching keyword wins, so «зубная паста» goes to
 * hygiene rather than pasta and «масло сливочное» to dairy rather than oils.
 */
export function aisleOf(title: string): Aisle {
  const text = title.toLowerCase();
  let best: { id: Aisle; length: number } = { id: 'other', length: 0 };
  for (const aisle of AISLES)
    for (const word of aisle.words)
      if (word.length > best.length && text.includes(word))
        best = { id: aisle.id, length: word.length };
  return best.id;
}
