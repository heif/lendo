// Item → emoji "avatar" for map pins (mirrors the prototype's EMO table, plus keyword synonyms).
// Order matters: more specific phrases first. Owners can override on the edit page.
const TABLE: [RegExp, string][] = [
  [/\b(e-?scooter|scooter)\b/i, '🛴'], [/\b(e-?bike|bicycle|bike)\b/i, '🚲'], [/\bdirt ?bike|motorcycle|moped\b/i, '🏍️'], [/\bbike trailer|burley\b/i, '🐾'],
  [/\bcar\b|\bsedan\b|\bsuv\b|\bvan\b|\btruck\b/i, '🚗'], [/\bwagon|radio flyer|cart\b/i, '🛒'], [/\bstroller|bassinet|crib|pack ?n ?play\b/i, '👶'],
  [/\bdrill|driver|impact\b/i, '🪛'], [/\b(circular |table |jig|miter |chain)?saw\b/i, '🪚'], [/\btool ?box|tool ?kit|wrench|socket\b/i, '🧰'], [/\bladder|step ?stool\b/i, '🪜'],
  [/\bpressure ?washer|power ?washer\b/i, '🚿'], [/\bleaf ?blower|blower\b/i, '🍂'], [/\bflashlight|lantern|headlamp\b/i, '🔦'], [/\bmetal ?detector\b/i, '🧲'],
  [/\bsewing|serger\b/i, '🧵'], [/\bprinter\b/i, '🖨️'], [/\bmonitor|display\b/i, '🖥️'], [/\bprojector\b/i, '📽️'], [/\bcamera|dslr|lens|gopro\b/i, '📷'], [/\binstax|polaroid\b/i, '📸'],
  [/\bvr\b|quest|headset\b/i, '🥽'], [/\barcade|pinball\b/i, '🕹️'], [/\bnintendo|switch|playstation|xbox|console|retro|snes|n64\b/i, '🎮'], [/\bboard ?games?|puzzle|dice\b/i, '🎲'], [/\bdarts?\b/i, '🎯'],
  [/\btelescope\b/i, '🔭'], [/\bmicroscope\b/i, '🔬'], [/\bvhs|camcorder\b/i, '📼'], [/\bturntable|record player|vinyl\b/i, '💿'], [/\bwalkman|radio|boombox\b/i, '📻'],
  [/\bguitar|ukulele|bass\b/i, '🎸'], [/\bkeyboard|piano|synth\b/i, '🎹'], [/\bdj|cdj|decks?\b|controller\b/i, '🎧'], [/\bamp(lifier)?\b|pedal|mixer board/i, '🎛️'], [/\bdrum|cajon\b/i, '🥁'],
  [/\bmic(rophone)?\b|karaoke/i, '🎤'], [/\bspeaker|soundbar|pa system|subwoofer\b/i, '🔊'], [/\btrumpet|horn|sax\b/i, '🎺'], [/\bviolin|viola|cello\b/i, '🎻'], [/\bdisco ?ball\b/i, '🪩'],
  [/\btent\b/i, '⛺'], [/\bkayak|canoe|paddle ?board|sup\b/i, '🛶'], [/\bcooler|yeti\b/i, '🧊'], [/\bbackpack|hiking pack\b/i, '🎒'], [/\bsleeping ?bag|camp(ing)? ?(stove|chair|pad)\b/i, '🏕️'],
  [/\bskis?|ski boots|poles\b/i, '🎿'], [/\bsnowboard\b/i, '🏂'], [/\bice ?skates?\b/i, '⛸️'], [/\broller ?(skates|blades)|inline\b/i, '🛼'], [/\bskateboard|longboard\b/i, '🛹'],
  [/\bfishing|rod|reel|tackle\b/i, '🎣'], [/\bkite\b/i, '🪁'], [/\bpickle ?ball|paddle\b/i, '🏓'], [/\btennis|racket|racquet\b/i, '🎾'], [/\bgolf|clubs\b/i, '⛳'], [/\bsurf ?board|wetsuit\b/i, '🏄'],
  [/\bbounce ?house|bouncy\b/i, '🏰'], [/\bcotton ?candy\b/i, '🍭'], [/\bpopcorn\b/i, '🍿'], [/\bwaffle\b/i, '🧇'], [/\bfondue\b/i, '🫕'], [/\bdutch ?oven|le creuset|pot\b/i, '🍲'],
  [/\bespresso|coffee|breville|nespresso|grinder\b/i, '☕'], [/\bstand ?mixer|kitchenaid|mixer\b/i, '🥣'], [/\bblender|vitamix\b/i, '🥤'], [/\bgrill|smoker|bbq\b/i, '🍖'], [/\btable\b/i, '🍽️'], [/\bchairs?\b|stool\b/i, '🪑'],
  [/\bsuitcase|luggage|carry-?on\b/i, '🧳'], [/\bduffel|duffle|bag\b/i, '👜'], [/\bjacket|coat|parka\b/i, '🧥'], [/\bgown|dress\b/i, '👗'], [/\bsuit|tux(edo)?|blazer|garment\b/i, '👔'], [/\bairwrap|dyson|hair ?dryer|curler\b/i, '🪮'],
  [/\bdog\b|corgi|puppy/i, '🐕'], [/\bcat\b|kitten/i, '🐈'], [/\brabbit|bunny\b/i, '🐇'], [/\bparrot|bird\b/i, '🦜'], [/\bhamster\b/i, '🐹'], [/\btortoise|turtle\b/i, '🐢'], [/\bpet ?(carrier|crate|stroller|gate)\b/i, '🐾'],
  [/\bbook|novel|textbook\b/i, '📚'], [/\blego\b/i, '🧱'], [/\btoy|doll\b/i, '🧸'], [/\bfan\b/i, '🌀'], [/\bheater\b/i, '🔥'], [/\bvacuum|dyson v|roomba\b/i, '🧹'], [/\bsteamer|iron\b/i, '🧼'],
  [/\bprojector screen|screen\b/i, '🎬'], [/\btripod|light|ring light|softbox\b/i, '💡'], [/\bgenerator|battery|power station\b/i, '🔋'], [/\bdrone\b/i, '🚁'], [/\bbinoculars\b/i, '🔭'],
  [/\bcrutches|wheelchair|walker|boot\b/i, '🩼'], [/\bmassage|theragun\b/i, '💆'], [/\bweights?|dumbbell|kettlebell|bench\b/i, '🏋️'], [/\byoga|mat\b/i, '🧘'], [/\btreadmill|peloton|rower\b/i, '🏃'],
  [/\bcostume|wig|halloween\b/i, '🎭'], [/\bballoon|party|piñata\b/i, '🎉'], [/\bchristmas|tree|lights\b/i, '🎄'], [/\bmenorah\b/i, '🕎'], [/\bfolding ?table|tablecloth|chafing\b/i, '🍽️'],
];
export function emojiFor(name: string, description?: string | null): string {
  const text = `${name} ${description || ''}`;
  for (const [re, e] of TABLE) if (re.test(name)) return e;
  for (const [re, e] of TABLE) if (re.test(text)) return e;
  return '📦';
}
