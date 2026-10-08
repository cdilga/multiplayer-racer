// The photographs kept as references (art/references/australia/README.md, P1-U05.3): Wikimedia Commons, with author and
// licence. Reference only: nothing here is shipped or traced.
export interface Reference {
  title: string;
  url: string;
  author: string;
  licence: string;
  licenceUrl: string;
}

const BY4 = 'https://creativecommons.org/licenses/by/4.0';
const BYSA4 = 'https://creativecommons.org/licenses/by-sa/4.0';
const BYSA3 = 'https://creativecommons.org/licenses/by-sa/3.0';

export const REFERENCES: Reference[] = [
  { title: 'AUS Brisbane, St Lucia, Sisley Street 002', url: 'https://commons.wikimedia.org/wiki/File:AUS_Brisbane,_St_Lucia,_Sisley_Street_002.jpg', author: '-wuppertaler', licence: 'CC BY 4.0', licenceUrl: BY4 },
  { title: 'Fremantle Traffic Bridge guardrail', url: 'https://commons.wikimedia.org/wiki/File:Fremantle_Traffic_Bridge_guardrail.jpg', author: 'Sam Wilson', licence: 'CC BY-SA 4.0', licenceUrl: BYSA4 },
  { title: 'Box culvert bridge in Cecil Hills', url: 'https://commons.wikimedia.org/wiki/File:Box_culvert_bridge_in_Cecil_Hills.jpg', author: 'Edwin H', licence: 'CC BY-SA 4.0', licenceUrl: BYSA4 },
  { title: 'Cunninghams Gap', url: 'https://commons.wikimedia.org/wiki/File:Cunninghams_Gap.JPG', author: 'Cgoodwin', licence: 'CC BY-SA 3.0', licenceUrl: BYSA3 },
  { title: 'Helensburgh NSW 2508, Australia - panoramio (31)', url: 'https://commons.wikimedia.org/wiki/File:Helensburgh_NSW_2508,_Australia_-_panoramio_(31).jpg', author: 'Maksym Kozlenko', licence: 'CC BY-SA 3.0', licenceUrl: BYSA3 },
];
