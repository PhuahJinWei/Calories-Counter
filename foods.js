'use strict';

// Built-in food list shown when adding food.
// kcal = rough calories for a normal portion. "A small amount" uses 70% of this,
// "A lot" uses 140%. Edit, add or remove lines freely; groups appear in the
// order they first show up here.
const FOODS = [
  // Meals
  { group: 'Meals', name: 'Chicken rice', kcal: 600 },
  { group: 'Meals', name: 'Fried rice', kcal: 650 },
  { group: 'Meals', name: 'Rice with meat and vegetables', kcal: 600 },
  { group: 'Meals', name: 'Curry with rice', kcal: 700 },
  { group: 'Meals', name: 'Nasi lemak', kcal: 650 },
  { group: 'Meals', name: 'Noodle soup', kcal: 450 },
  { group: 'Meals', name: 'Fried noodles', kcal: 650 },
  { group: 'Meals', name: 'Dumplings (6 pieces)', kcal: 300 },
  { group: 'Meals', name: 'Sushi (8 pieces)', kcal: 350 },
  { group: 'Meals', name: 'Grilled fish with rice', kcal: 500 },
  { group: 'Meals', name: 'Fried chicken (2 pieces)', kcal: 500 },
  { group: 'Meals', name: 'Pasta with sauce', kcal: 550 },
  { group: 'Meals', name: 'Pizza (2 slices)', kcal: 550 },
  { group: 'Meals', name: 'Burger', kcal: 500 },
  { group: 'Meals', name: 'French fries', kcal: 350 },
  { group: 'Meals', name: 'Sandwich', kcal: 350 },
  { group: 'Meals', name: 'Steak with potatoes', kcal: 700 },
  { group: 'Meals', name: 'Salad', kcal: 200 },
  { group: 'Meals', name: 'Soup', kcal: 200 },

  // Breakfast
  { group: 'Breakfast foods', name: 'Bread with butter (2 slices)', kcal: 250 },
  { group: 'Breakfast foods', name: 'Toast with jam (2 slices)', kcal: 250 },
  { group: 'Breakfast foods', name: 'Two eggs', kcal: 180 },
  { group: 'Breakfast foods', name: 'Roti canai with curry', kcal: 360 },
  { group: 'Breakfast foods', name: 'Cereal with milk', kcal: 250 },
  { group: 'Breakfast foods', name: 'Oats or porridge', kcal: 250 },
  { group: 'Breakfast foods', name: 'Pancakes', kcal: 350 },
  { group: 'Breakfast foods', name: 'Yogurt', kcal: 120 },

  // Fruit
  { group: 'Fruit', name: 'Banana', kcal: 100 },
  { group: 'Fruit', name: 'Apple', kcal: 80 },
  { group: 'Fruit', name: 'Orange', kcal: 60 },
  { group: 'Fruit', name: 'Bowl of mixed fruit', kcal: 100 },

  // Snacks and sweets
  { group: 'Snacks and sweets', name: 'Biscuits (3)', kcal: 150 },
  { group: 'Snacks and sweets', name: 'Small bag of chips', kcal: 150 },
  { group: 'Snacks and sweets', name: 'Chocolate bar', kcal: 230 },
  { group: 'Snacks and sweets', name: 'Slice of cake', kcal: 350 },
  { group: 'Snacks and sweets', name: 'Bun or pastry', kcal: 300 },
  { group: 'Snacks and sweets', name: 'Handful of nuts', kcal: 170 },
  { group: 'Snacks and sweets', name: 'Ice cream (1 scoop)', kcal: 140 },

  // Drinks
  { group: 'Drinks', name: 'Coffee with milk', kcal: 90 },
  { group: 'Drinks', name: 'Coffee with milk and sugar', kcal: 120 },
  { group: 'Drinks', name: 'Tea with milk and sugar', kcal: 80 },
  { group: 'Drinks', name: 'Glass of milk', kcal: 120 },
  { group: 'Drinks', name: 'Glass of fruit juice', kcal: 110 },
  { group: 'Drinks', name: 'Soft drink (can)', kcal: 140 },
  { group: 'Drinks', name: 'Bubble tea', kcal: 350 },
  { group: 'Drinks', name: 'Beer (can)', kcal: 150 },
  { group: 'Drinks', name: 'Glass of wine', kcal: 120 },
];
