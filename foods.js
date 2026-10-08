'use strict';

// Built-in food list shown when adding food, written for everyday eating in Japan.
//
//   g    = group (see FOOD_GROUP_NAMES below; groups appear in that order)
//   ja   = Japanese name shown on screen
//   kana = reading in hiragana, so searching "ぎゅうどん" finds 牛丼
//   en   = English name
//   kcal = rough calories for a normal portion. "少なめ" uses 70% of this, "多め" 140%.
//
// Basic foods (rice, bread, eggs, fruit, milk...) follow Japan's Standard Tables of
// Food Composition (日本食品標準成分表 2020, 8th ed.). Dishes are typical values for
// a normal shop or home portion. Everything is rounded: a good guess, not a label.
// Edit, add or remove lines freely.
const FOOD_GROUP_NAMES = {
  staple: { ja: 'ごはん・パン・めん', en: 'Rice, bread and noodles' },
  dish: { ja: '丼・定食・外食', en: 'Rice bowls, set meals and eating out' },
  side: { ja: 'おかず・汁物', en: 'Side dishes and soups' },
  konbini: { ja: 'コンビニ', en: 'Convenience store' },
  fruit: { ja: '果物・乳製品', en: 'Fruit and dairy' },
  sweet: { ja: 'お菓子・甘いもの', en: 'Snacks and sweets' },
  drink: { ja: '飲み物', en: 'Drinks' },
  alcohol: { ja: 'お酒', en: 'Alcohol' },
};

const FOODS = [
  // ごはん・パン・めん
  { g: 'staple', ja: 'ごはん（茶碗1杯）', kana: 'ごはん ちゃわん', en: 'Rice (1 bowl, 150g)', kcal: 234 },
  { g: 'staple', ja: '玄米ごはん（茶碗1杯）', kana: 'げんまいごはん ちゃわん', en: 'Brown rice (1 bowl)', kcal: 228 },
  { g: 'staple', ja: '食パン（6枚切り1枚）', kana: 'しょくぱん', en: 'Bread (1 thick slice)', kcal: 150 },
  { g: 'staple', ja: 'トースト（バター付き・1枚）', kana: 'とーすと ばたー', en: 'Toast with butter (1 slice)', kcal: 210 },
  { g: 'staple', ja: 'ロールパン（2個）', kana: 'ろーるぱん', en: 'Bread rolls (2)', kcal: 190 },
  { g: 'staple', ja: 'クロワッサン（1個）', kana: 'くろわっさん', en: 'Croissant', kcal: 180 },
  { g: 'staple', ja: 'もち（2個）', kana: 'もち おもち', en: 'Rice cakes / mochi (2)', kcal: 220 },
  { g: 'staple', ja: 'かけうどん', kana: 'かけうどん', en: 'Udon noodle soup', kcal: 320 },
  { g: 'staple', ja: 'きつねうどん', kana: 'きつねうどん', en: 'Udon with fried tofu', kcal: 420 },
  { g: 'staple', ja: 'ざるそば', kana: 'ざるそば もりそば', en: 'Cold soba noodles', kcal: 320 },
  { g: 'staple', ja: '天ぷらそば', kana: 'てんぷらそば', en: 'Soba with tempura', kcal: 480 },
  { g: 'staple', ja: 'そうめん（2束）', kana: 'そうめん', en: 'Somen noodles (2 bundles)', kcal: 360 },
  { g: 'staple', ja: 'ラーメン（しょうゆ）', kana: 'らーめん しょうゆ', en: 'Ramen (soy sauce)', kcal: 500 },
  { g: 'staple', ja: 'とんこつラーメン', kana: 'とんこつらーめん', en: 'Ramen (pork broth)', kcal: 650 },
  { g: 'staple', ja: '焼きそば', kana: 'やきそば', en: 'Fried noodles (yakisoba)', kcal: 550 },

  // 丼・定食・外食
  { g: 'dish', ja: '牛丼（並盛）', kana: 'ぎゅうどん なみもり', en: 'Beef bowl (regular)', kcal: 650 },
  { g: 'dish', ja: '親子丼', kana: 'おやこどん', en: 'Chicken and egg rice bowl', kcal: 700 },
  { g: 'dish', ja: 'カツ丼', kana: 'かつどん', en: 'Pork cutlet rice bowl', kcal: 900 },
  { g: 'dish', ja: '天丼', kana: 'てんどん', en: 'Tempura rice bowl', kcal: 800 },
  { g: 'dish', ja: '海鮮丼', kana: 'かいせんどん', en: 'Seafood rice bowl', kcal: 600 },
  { g: 'dish', ja: 'カレーライス', kana: 'かれーらいす', en: 'Curry rice', kcal: 750 },
  { g: 'dish', ja: 'カツカレー', kana: 'かつかれー', en: 'Curry rice with pork cutlet', kcal: 1000 },
  { g: 'dish', ja: 'オムライス', kana: 'おむらいす', en: 'Omelette rice', kcal: 750 },
  { g: 'dish', ja: 'チャーハン', kana: 'ちゃーはん', en: 'Fried rice', kcal: 700 },
  { g: 'dish', ja: '焼き魚定食（鮭）', kana: 'やきざかなていしょく さけ しゃけ', en: 'Grilled salmon set meal', kcal: 600 },
  { g: 'dish', ja: '刺身定食', kana: 'さしみていしょく', en: 'Sashimi set meal', kcal: 550 },
  { g: 'dish', ja: '唐揚げ定食', kana: 'からあげていしょく', en: 'Fried chicken set meal', kcal: 900 },
  { g: 'dish', ja: 'とんかつ定食', kana: 'とんかつていしょく', en: 'Pork cutlet set meal', kcal: 950 },
  { g: 'dish', ja: '生姜焼き定食', kana: 'しょうがやきていしょく', en: 'Ginger pork set meal', kcal: 850 },
  { g: 'dish', ja: 'ハンバーグ定食', kana: 'はんばーぐていしょく', en: 'Hamburg steak set meal', kcal: 800 },
  { g: 'dish', ja: 'にぎり寿司（8貫）', kana: 'にぎりずし すし', en: 'Nigiri sushi (8 pieces)', kcal: 400 },
  { g: 'dish', ja: '回転寿司（5皿）', kana: 'かいてんずし すし', en: 'Conveyor-belt sushi (5 plates)', kcal: 450 },
  { g: 'dish', ja: 'お好み焼き', kana: 'おこのみやき', en: 'Okonomiyaki', kcal: 650 },
  { g: 'dish', ja: 'たこ焼き（8個）', kana: 'たこやき', en: 'Takoyaki (8)', kcal: 400 },
  { g: 'dish', ja: '鍋（寄せ鍋・1人分）', kana: 'なべ よせなべ', en: 'Hot pot (1 serving)', kcal: 350 },
  { g: 'dish', ja: 'パスタ（ミートソース）', kana: 'ぱすた みーとそーす すぱげってぃ', en: 'Pasta with meat sauce', kcal: 650 },
  { g: 'dish', ja: 'パスタ（和風・ペペロンチーノ）', kana: 'ぱすた わふう ぺぺろんちーの すぱげってぃ', en: 'Pasta (Japanese-style or oil and garlic)', kcal: 550 },
  { g: 'dish', ja: 'ピザ（2切れ）', kana: 'ぴざ', en: 'Pizza (2 slices)', kcal: 500 },
  { g: 'dish', ja: 'ハンバーガー', kana: 'はんばーがー', en: 'Hamburger', kcal: 300 },
  { g: 'dish', ja: 'フライドポテト（M）', kana: 'ふらいどぽてと', en: 'French fries (medium)', kcal: 410 },

  // おかず・汁物
  { g: 'side', ja: 'みそ汁', kana: 'みそしる', en: 'Miso soup', kcal: 40 },
  { g: 'side', ja: '豚汁', kana: 'とんじる ぶたじる', en: 'Pork and vegetable miso soup', kcal: 130 },
  { g: 'side', ja: '納豆（1パック）', kana: 'なっとう', en: 'Natto (1 pack)', kcal: 95 },
  { g: 'side', ja: '冷ややっこ', kana: 'ひややっこ とうふ', en: 'Chilled tofu', kcal: 80 },
  { g: 'side', ja: '卵焼き（2切れ）', kana: 'たまごやき', en: 'Rolled omelette (2 pieces)', kcal: 100 },
  { g: 'side', ja: '目玉焼き（1個）', kana: 'めだまやき たまご', en: 'Fried egg', kcal: 100 },
  { g: 'side', ja: 'ゆで卵（1個）', kana: 'ゆでたまご', en: 'Boiled egg', kcal: 70 },
  { g: 'side', ja: '焼き鮭（1切れ）', kana: 'やきざけ しゃけ さけ', en: 'Grilled salmon (1 piece)', kcal: 150 },
  { g: 'side', ja: 'さばの塩焼き（1切れ）', kana: 'さばのしおやき', en: 'Grilled mackerel (1 piece)', kcal: 230 },
  { g: 'side', ja: '刺身（盛り合わせ）', kana: 'さしみ', en: 'Sashimi (assorted)', kcal: 150 },
  { g: 'side', ja: '唐揚げ（3個）', kana: 'からあげ', en: 'Fried chicken (3 pieces)', kcal: 270 },
  { g: 'side', ja: 'コロッケ（1個）', kana: 'ころっけ', en: 'Croquette', kcal: 220 },
  { g: 'side', ja: '天ぷら（盛り合わせ）', kana: 'てんぷら', en: 'Tempura (assorted)', kcal: 400 },
  { g: 'side', ja: '餃子（6個）', kana: 'ぎょうざ', en: 'Gyoza dumplings (6)', kcal: 300 },
  { g: 'side', ja: '肉じゃが', kana: 'にくじゃが', en: 'Meat and potato stew', kcal: 250 },
  { g: 'side', ja: '野菜炒め', kana: 'やさいいため', en: 'Stir-fried vegetables', kcal: 250 },
  { g: 'side', ja: 'サラダ（ドレッシング付き）', kana: 'さらだ', en: 'Salad with dressing', kcal: 100 },
  { g: 'side', ja: 'ほうれん草のおひたし', kana: 'ほうれんそうのおひたし', en: 'Boiled spinach with soy sauce', kcal: 20 },
  { g: 'side', ja: 'きんぴらごぼう', kana: 'きんぴらごぼう', en: 'Braised burdock root', kcal: 80 },
  { g: 'side', ja: '漬物', kana: 'つけもの おしんこ', en: 'Pickles', kcal: 15 },

  // コンビニ
  { g: 'konbini', ja: 'おにぎり（鮭・梅など）', kana: 'おにぎり おむすび さけ うめ', en: 'Rice ball (salmon, plum...)', kcal: 180 },
  { g: 'konbini', ja: 'ツナマヨおにぎり', kana: 'つなまよおにぎり おむすび', en: 'Tuna mayo rice ball', kcal: 230 },
  { g: 'konbini', ja: 'お弁当', kana: 'おべんとう べんとう', en: 'Boxed lunch (bento)', kcal: 750 },
  { g: 'konbini', ja: 'サンドイッチ（ミックス）', kana: 'さんどいっち', en: 'Sandwich (mixed)', kcal: 300 },
  { g: 'konbini', ja: 'たまごサンド', kana: 'たまごさんど さんどいっち', en: 'Egg sandwich', kcal: 350 },
  { g: 'konbini', ja: 'サラダチキン（1パック）', kana: 'さらだちきん', en: 'Ready-to-eat chicken breast', kcal: 110 },
  { g: 'konbini', ja: '肉まん', kana: 'にくまん', en: 'Steamed meat bun', kcal: 250 },
  { g: 'konbini', ja: 'おでん（5品）', kana: 'おでん', en: 'Oden (5 pieces)', kcal: 250 },
  { g: 'konbini', ja: 'カップラーメン', kana: 'かっぷらーめん かっぷめん', en: 'Cup noodles', kcal: 350 },
  { g: 'konbini', ja: 'カップ焼きそば', kana: 'かっぷやきそば', en: 'Cup yakisoba', kcal: 550 },

  // 果物・乳製品
  { g: 'fruit', ja: 'バナナ（1本）', kana: 'ばなな', en: 'Banana', kcal: 90 },
  { g: 'fruit', ja: 'りんご（半分）', kana: 'りんご', en: 'Apple (half)', kcal: 80 },
  { g: 'fruit', ja: 'みかん（1個）', kana: 'みかん', en: 'Mandarin orange', kcal: 40 },
  { g: 'fruit', ja: 'いちご（5粒）', kana: 'いちご', en: 'Strawberries (5)', kcal: 25 },
  { g: 'fruit', ja: 'キウイ（1個）', kana: 'きうい', en: 'Kiwi fruit', kcal: 45 },
  { g: 'fruit', ja: '柿（1個）', kana: 'かき', en: 'Persimmon', kcal: 100 },
  { g: 'fruit', ja: 'ヨーグルト（無糖・100g）', kana: 'よーぐると むとう', en: 'Plain yogurt (100g)', kcal: 60 },
  { g: 'fruit', ja: 'ヨーグルト（加糖・1個）', kana: 'よーぐると かとう', en: 'Sweetened yogurt (1 cup)', kcal: 90 },
  { g: 'fruit', ja: 'チーズ（1切れ）', kana: 'ちーず', en: 'Cheese (1 slice)', kcal: 60 },

  // お菓子・甘いもの
  { g: 'sweet', ja: 'メロンパン', kana: 'めろんぱん', en: 'Melon bread', kcal: 400 },
  { g: 'sweet', ja: 'あんパン', kana: 'あんぱん', en: 'Sweet bean bun', kcal: 280 },
  { g: 'sweet', ja: 'クリームパン', kana: 'くりーむぱん', en: 'Custard cream bun', kcal: 280 },
  { g: 'sweet', ja: 'どら焼き', kana: 'どらやき', en: 'Dorayaki', kcal: 230 },
  { g: 'sweet', ja: '大福', kana: 'だいふく', en: 'Daifuku (mochi with bean paste)', kcal: 180 },
  { g: 'sweet', ja: 'みたらし団子（1本）', kana: 'みたらしだんご', en: 'Sweet soy rice dumplings (1 stick)', kcal: 120 },
  { g: 'sweet', ja: 'ようかん（1切れ）', kana: 'ようかん', en: 'Yokan (1 slice)', kcal: 140 },
  { g: 'sweet', ja: 'せんべい（2枚）', kana: 'せんべい おせんべい', en: 'Rice crackers (2)', kcal: 90 },
  { g: 'sweet', ja: 'ポテトチップス（1袋・60g）', kana: 'ぽてとちっぷす', en: 'Potato chips (60g bag)', kcal: 330 },
  { g: 'sweet', ja: 'チョコレート（板チョコ半分）', kana: 'ちょこれーと いたちょこ', en: 'Chocolate (half a bar)', kcal: 140 },
  { g: 'sweet', ja: 'クッキー（3枚）', kana: 'くっきー びすけっと', en: 'Cookies (3)', kcal: 150 },
  { g: 'sweet', ja: 'ショートケーキ', kana: 'しょーとけーき けーき', en: 'Strawberry shortcake', kcal: 350 },
  { g: 'sweet', ja: 'シュークリーム', kana: 'しゅーくりーむ', en: 'Cream puff', kcal: 220 },
  { g: 'sweet', ja: 'プリン', kana: 'ぷりん', en: 'Custard pudding', kcal: 150 },
  { g: 'sweet', ja: 'アイスクリーム（カップ）', kana: 'あいすくりーむ あいす', en: 'Ice cream (cup)', kcal: 200 },
  { g: 'sweet', ja: 'ナッツ（ひとつかみ）', kana: 'なっつ', en: 'Nuts (a handful)', kcal: 150 },

  // 飲み物
  { g: 'drink', ja: '緑茶・麦茶・水', kana: 'りょくちゃ むぎちゃ おちゃ みず', en: 'Green tea, barley tea or water', kcal: 0 },
  { g: 'drink', ja: 'ブラックコーヒー', kana: 'ぶらっくこーひー', en: 'Black coffee', kcal: 10 },
  { g: 'drink', ja: 'カフェラテ', kana: 'かふぇらて', en: 'Caffe latte', kcal: 150 },
  { g: 'drink', ja: '缶コーヒー（微糖）', kana: 'かんこーひー びとう', en: 'Canned coffee (less sugar)', kcal: 45 },
  { g: 'drink', ja: '缶コーヒー（加糖）', kana: 'かんこーひー かとう', en: 'Canned coffee (sweet)', kcal: 80 },
  { g: 'drink', ja: '紅茶（ミルク・砂糖入り）', kana: 'こうちゃ みるくてぃー', en: 'Tea with milk and sugar', kcal: 50 },
  { g: 'drink', ja: '牛乳（コップ1杯）', kana: 'ぎゅうにゅう みるく', en: 'Milk (1 glass, 200ml)', kcal: 130 },
  { g: 'drink', ja: '豆乳（200ml）', kana: 'とうにゅう', en: 'Soy milk (200ml)', kcal: 120 },
  { g: 'drink', ja: 'オレンジジュース（コップ1杯）', kana: 'おれんじじゅーす', en: 'Orange juice (1 glass)', kcal: 90 },
  { g: 'drink', ja: '野菜ジュース（200ml）', kana: 'やさいじゅーす', en: 'Vegetable juice (200ml)', kcal: 70 },
  { g: 'drink', ja: 'コーラ・炭酸飲料（500ml）', kana: 'こーら たんさんいんりょう さいだー', en: 'Cola or soda (500ml)', kcal: 225 },
  { g: 'drink', ja: 'スポーツドリンク（500ml）', kana: 'すぽーつどりんく', en: 'Sports drink (500ml)', kcal: 125 },
  { g: 'drink', ja: 'タピオカミルクティー', kana: 'たぴおかみるくてぃー', en: 'Bubble tea', kcal: 350 },

  // お酒
  { g: 'alcohol', ja: 'ビール（350ml缶）', kana: 'びーる はっぽうしゅ', en: 'Beer (350ml can)', kcal: 140 },
  { g: 'alcohol', ja: '生ビール（中ジョッキ）', kana: 'なまびーる ちゅうじょっき', en: 'Draft beer (medium mug)', kcal: 180 },
  { g: 'alcohol', ja: 'チューハイ（350ml缶）', kana: 'ちゅーはい さわー', en: 'Chuhai (350ml can)', kcal: 180 },
  { g: 'alcohol', ja: 'ハイボール（1杯）', kana: 'はいぼーる', en: 'Highball (1 glass)', kcal: 80 },
  { g: 'alcohol', ja: '日本酒（1合）', kana: 'にほんしゅ おさけ', en: 'Sake (180ml)', kcal: 190 },
  { g: 'alcohol', ja: '焼酎（水割り1杯）', kana: 'しょうちゅう みずわり', en: 'Shochu with water (1 glass)', kcal: 90 },
  { g: 'alcohol', ja: 'ワイン（グラス1杯）', kana: 'わいん', en: 'Wine (1 glass)', kcal: 90 },
  { g: 'alcohol', ja: '梅酒（1杯）', kana: 'うめしゅ', en: 'Plum wine (1 glass)', kcal: 100 },
];
