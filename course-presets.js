// Supplied scorecards explicitly show yards. Store rounded metres for the app.
const fromCard = (id, name, tee, par, si, yards, note = '') => ({
  id, name, tee, note,
  holes: par.map((value, i) => ({
    number: i + 1, par: value, si: si[i], distance: Math.round(yards[i] * 0.9144)
  }))
});

const breakersPar = [4,3,4,3,4,3,4,4,4];
const breakersYards = [375,138,352,176,404,167,415,406,322];
const breakersFront = [7,17,9,15,1,13,5,3,11];
const breakersBack = [8,18,10,16,2,14,6,4,12];
// Rank the front-loop SI 1–18 values among the nine physical holes. The
// separately listed second-loop indexes remain on the 18-hole preset.
const breakersNine = breakersFront.map(si => [...breakersFront].sort((a,b) => a-b).indexOf(si) + 1);

export const COURSE_PRESETS = [
  fromCard('breakers-blue-9', 'Breakers Country Club (Terrigal)', 'Blue/White · 9 holes', breakersPar, breakersNine, breakersYards,
    'The source labels the club Terrigal. Nine-hole indexes 1–9 follow the first-loop difficulty order.'),
  fromCard('breakers-blue-18', 'Breakers Country Club (Terrigal)', 'Blue/White · 18 holes', [...breakersPar,...breakersPar], [...breakersFront,...breakersBack], [...breakersYards,...breakersYards],
    'The source labels the club Terrigal. Two loops of nine retain the separate front and back indexes on the card.'),
  fromCard('shelly-mens-18', 'Shelly Beach', 'Mens · 18 holes',
    [5,4,4,3,4,4,4,4,3,3,4,4,3,4,5,4,4,5],
    [11,2,9,14,13,6,12,15,8,17,5,1,10,3,16,4,7,18],
    [551,431,415,145,394,364,396,393,174,131,429,439,164,433,438,344,337,583]),
  fromCard('wyong-white-18', 'Wyong', 'White · 18 holes',
    [4,4,5,3,5,4,4,4,3,5,4,4,3,4,3,5,3,4],
    [11,2,15,18,10,4,8,13,6,9,5,1,16,7,12,14,17,3],
    [392,423,498,156,453,354,370,302,190,574,400,415,146,349,159,475,149,396]),
  fromCard('kooindah-white-18', 'Kooindah Waters Golf Club', 'White · 18 holes',
    [5,3,4,3,5,3,4,5,4,5,4,3,4,4,5,4,3,4],
    [13,7,5,15,11,9,17,1,3,12,8,18,6,14,4,10,16,2],
    [462,147,399,155,500,138,367,503,353,504,384,161,386,312,561,379,127,418]),
  fromCard('magenta-white-18', 'Magenta Shores', 'White · 18 holes',
    [4,5,4,3,4,4,3,5,4,5,4,3,4,4,3,4,4,5],
    [5,9,3,14,11,15,18,13,1,12,10,16,8,2,17,6,7,4],
    [372,521,418,178,347,310,120,477,438,501,335,149,317,389,123,381,369,492]),
  fromCard('toukley-white-18', 'Toukley', 'White · 18 holes',
    [5,4,4,5,4,3,4,3,4,4,4,5,3,4,5,4,3,4],
    [11,3,13,17,7,9,5,15,1,10,14,12,16,8,2,18,6,4],
    [510,406,287,471,388,171,387,127,405,361,331,503,148,364,576,291,189,387]),
  fromCard('gosford-white-18', 'Gosford', 'White · 18 holes',
    [4,5,4,4,3,4,4,3,4,5,4,3,4,3,4,4,4,5],
    [17,15,5,9,11,3,13,7,1,16,4,8,6,10,12,14,2,18],
    [312,493,405,360,180,415,375,184,421,484,399,167,401,149,333,330,378,456])
];
