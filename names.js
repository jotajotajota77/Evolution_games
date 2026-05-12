// Pseudo-binomial name generator. Inspired by latin taxonomy + sci-fi
// taxon names. Used for the suggested name when creating a new lineage and
// for naming sub-species when speciation events fire.

const GENERA = [
  'Xenotauri', 'Cryopora', 'Plasmovita', 'Nebulae', 'Necropteryx',
  'Photogen', 'Symbiomorpha', 'Aetherspora', 'Vorthidae', 'Eunoetus',
  'Heliotrope', 'Chronoxenus', 'Stellaria', 'Pulsorix', 'Quantophorus',
  'Anabiomorpha', 'Pyrocaecius', 'Geliderma', 'Thaumarctos', 'Trilophion',
  'Selenodon', 'Andromedis', 'Cosmocaris', 'Mycopodion', 'Sublimaris',
  'Plasmaphytum', 'Quasarion', 'Veridian', 'Cryptolux', 'Nyxoroth',
  'Tachyphor', 'Vortilum', 'Solenodonta', 'Hexaclonus', 'Mereton',
  'Lirathenia', 'Volkmarisia', 'Tessellaeus', 'Iridarothrix', 'Cataphractus',
  'Aeonis', 'Pyralia', 'Helvetia', 'Voltaria', 'Lumeneon',
  'Erebus', 'Cygnaris', 'Tritonax', 'Marabunta', 'Khorios',
];

const EPITHETS = [
  'vorax', 'prima', 'celer', 'fulgens', 'umbra',
  'novus', 'antiquus', 'mirabilis', 'sapiens', 'gracilis',
  'major', 'minor', 'sylvestris', 'oceanica', 'crepuscularis',
  'paradoxa', 'cryptica', 'magnifica', 'humilis', 'rapax',
  'fortis', 'fugax', 'tenebris', 'lucida', 'errans',
  'vagans', 'silens', 'callida', 'nebularis', 'galactica',
  'stellaris', 'siderea', 'quaesita', 'aurea', 'argentea',
  'fervens', 'frigida', 'ventosa', 'caelestis', 'profunda',
  'aquila', 'titanica', 'parva', 'gigantica', 'ferox',
  'pacifica', 'borealis', 'australis', 'orientalis', 'occidentalis',
];

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function randomBinomial() {
  return `${pick(GENERA)} ${pick(EPITHETS)}`;
}

export function randomEpithet() {
  return pick(EPITHETS);
}

// Takes the first whitespace-separated word as the genus. Used for derived
// child names so a sub-species shares its parent's genus.
export function genusOf(name) {
  return (name || '').trim().split(/\s+/)[0] || 'Incertae';
}

// Builds a sub-species name keeping the parent genus and picking a new
// epithet at random.
export function deriveChildName(parentName) {
  return `${genusOf(parentName)} ${randomEpithet()}`;
}
