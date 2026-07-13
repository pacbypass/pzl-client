/**
 * Module registry — the menu of features recovered from the `/units/{unit-id}`
 * resource tree in the decompiled bundle. `route` points at an Expo Router
 * screen under app/(app)/(tabs)/(menu)/(modules).
 *
 * `implemented: true` marks modules built end-to-end in this client; the rest
 * are scaffolded placeholders that slot into the same pattern.
 */
export type ModuleDef = {
  key: string;
  title: string; // Polish label (as in the original)
  subtitle: string;
  icon: string; // MaterialCommunityIcons name (react-native-paper)
  route: string;
  implemented?: boolean;
};

export const MODULES: ModuleDef[] = [
  {
    key: 'collective-huntings',
    title: 'Polowania zbiorowe',
    subtitle: 'Organizacja i rozliczenia polowań zbiorowych',
    icon: 'account-group',
    route: '/(app)/(tabs)/(menu)/(modules)/collective-huntings',
    implemented: true,
  },
  {
    key: 'hunting-damages',
    title: 'Szkody łowieckie',
    subtitle: 'Zgłoszenia i szacowanie szkód',
    icon: 'sprout',
    route: '/(app)/(tabs)/(menu)/(modules)/hunting-damages',
    implemented: true,
  },
  {
    key: 'annual-hunting-plans',
    title: 'Roczne plany łowieckie',
    subtitle: 'RPŁ i plany wykonania',
    icon: 'calendar-check',
    route: '/(app)/(tabs)/(menu)/(modules)/annual-hunting-plans',
  },
  {
    key: 'multi-year-plans',
    title: 'Wieloletnie plany łowieckie',
    subtitle: 'Planowanie długoterminowe',
    icon: 'chart-timeline-variant',
    route: '/(app)/(tabs)/(menu)/(modules)/multi-year-plans',
  },
  {
    key: 'electronic-hunting-book',
    title: 'Elektroniczna książka polowań',
    subtitle: 'Ewidencja LOW-1',
    icon: 'book-open-variant',
    route: '/(app)/(tabs)/(menu)/(modules)/electronic-hunting-book',
  },
  {
    key: 'authorizations',
    title: 'Upoważnienia do polowania',
    subtitle: 'Odstrzały indywidualne',
    icon: 'file-certificate',
    route: '/(app)/(tabs)/(menu)/(modules)/authorizations',
  },
  {
    key: 'material-book',
    title: 'Książka materiałowa',
    subtitle: 'Gospodarka materiałowa koła',
    icon: 'clipboard-list',
    route: '/(app)/(tabs)/(menu)/(modules)/material-book',
  },
  {
    key: 'game-breeding-centers',
    title: 'Ośrodki hodowli zwierzyny',
    subtitle: 'OHZ',
    icon: 'pine-tree',
    route: '/(app)/(tabs)/(menu)/(modules)/game-breeding-centers',
  },
  {
    key: 'board-meetings',
    title: 'Posiedzenia zarządu',
    subtitle: 'Uchwały, protokoły, ogłoszenia',
    icon: 'gavel',
    route: '/(app)/(tabs)/(menu)/(modules)/board-meetings',
  },
  {
    key: 'district-board-reports',
    title: 'Raporty ASF',
    subtitle: 'Tygodniowe raporty zarządów okręgowych',
    icon: 'virus',
    route: '/(app)/(tabs)/(menu)/(modules)/district-board-reports',
  },
  {
    key: 'economic-activity',
    title: 'Działalność gospodarcza',
    subtitle: 'Plany i protokoły',
    icon: 'briefcase',
    route: '/(app)/(tabs)/(menu)/(modules)/economic-activity',
  },
  {
    key: 'finances',
    title: 'Finanse',
    subtitle: 'Składki, depozyty, umowy',
    icon: 'cash-multiple',
    route: '/(app)/(tabs)/(menu)/(modules)/finances',
  },
  {
    key: 'hunters',
    title: 'Myśliwi i kandydaci',
    subtitle: 'Ewidencja członków, stażyści, wnioski',
    icon: 'account-multiple',
    route: '/(app)/(tabs)/(menu)/(modules)/hunters',
  },
];
