import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

const token = '608147:008369291fa894e30ff02d042efb7a04';
const subdomain = 'goblins-yard2';

function mapUom(posterUnit: string): string {
  const u = String(posterUnit || '').toLowerCase().trim();
  if (u === 'kg') return 'kg';
  if (u === 'g') return 'g';
  if (u === 'l' || u === 'liter' || u === 'L') return 'L';
  if (u === 'ml') return 'ml';
  if (u === 'pc' || u === 'p' || u === 'pcs' || u === 'piece' || u === 'шт') return 'pc';
  if (u === 'bottle') return 'bottle';
  return 'pc';
}

async function main() {
  console.log('Fetching data from Poster POS API...');
  
  // 1. Fetch Categories
  const catRes = await fetch(`https://${subdomain}.joinposter.com/api/menu.getCategories?token=${token}`);
  const catJson = await catRes.json() as any;
  if (catJson.error) {
    throw new Error(`Poster API error: ${JSON.stringify(catJson.error)}`);
  }
  const posterCategories = catJson.response || [];

  // 2. Fetch Ingredients
  const ingRes = await fetch(`https://${subdomain}.joinposter.com/api/menu.getIngredients?token=${token}`);
  const ingJson = await ingRes.json() as any;
  const posterIngredients = ingJson.response || [];

  // 3. Fetch Products with Recipes
  const prodRes = await fetch(`https://${subdomain}.joinposter.com/api/menu.getProducts?token=${token}&get_recipes=1`);
  const prodJson = await prodRes.json() as any;
  const posterProducts = prodJson.response || [];

  console.log(`Poster API fetched:`);
  console.log(`- Categories: ${posterCategories.length}`);
  console.log(`- Ingredients: ${posterIngredients.length}`);
  console.log(`- Products/Dishes: ${posterProducts.length}`);

  // Fetch Goblins defaults
  const defaultTaxRate = await prisma.taxRate.findFirst({ where: { isDefault: true } });
  const kitchenStation = await prisma.station.findFirst({ where: { name: 'Kitchen' } });
  const barStation = await prisma.station.findFirst({ where: { name: 'Bar' } });
  const mainStore = await prisma.storeLocation.findFirst({ where: { name: 'Main store' } });

  console.log('Defaults resolved:', {
    taxRateId: defaultTaxRate?.id,
    kitchenStationId: kitchenStation?.id,
    barStationId: barStation?.id,
    mainStoreId: mainStore?.id
  });

  // ----------------------------------------------------
  // Import Categories (Pass 1: creation without parent)
  // ----------------------------------------------------
  console.log('Importing categories...');
  for (const cat of posterCategories) {
    await prisma.category.upsert({
      where: { id: String(cat.category_id) },
      update: {
        name: cat.category_name,
        sortOrder: cat.sort_order ? parseInt(cat.sort_order) : 0,
      },
      create: {
        id: String(cat.category_id),
        name: cat.category_name,
        sortOrder: cat.sort_order ? parseInt(cat.sort_order) : 0,
        isActive: cat.category_hidden !== '1',
      }
    });
  }

  // Categories (Pass 2: update parent relations)
  console.log('Linking parent categories...');
  for (const cat of posterCategories) {
    if (cat.parent_category && cat.parent_category !== '0') {
      // Check if parent category exists locally
      const parentExists = await prisma.category.findUnique({ where: { id: String(cat.parent_category) } });
      if (parentExists) {
        await prisma.category.update({
          where: { id: String(cat.category_id) },
          data: { parentCategoryId: String(cat.parent_category) }
        });
      }
    }
  }

  // ----------------------------------------------------
  // Import Ingredients
  // ----------------------------------------------------
  console.log('Importing ingredients...');
  for (const ing of posterIngredients) {
    const uomId = mapUom(ing.ingredient_unit);
    
    // Ensure Uom exists in DB
    const uomExists = await prisma.uom.findUnique({ where: { id: uomId } });
    if (!uomExists) {
      await prisma.uom.create({ data: { id: uomId, label: uomId, baseUnit: uomId, factor: 1 } });
    }

    const localIng = await prisma.ingredient.upsert({
      where: { id: String(ing.ingredient_id) },
      update: {
        name: ing.ingredient_name,
        uomId,
        sku: ing.ingredient_barcode || null,
      },
      create: {
        id: String(ing.ingredient_id),
        name: ing.ingredient_name,
        uomId,
        sku: ing.ingredient_barcode || null,
      }
    });

    // Initialize/Update stock level in Main Store
    if (mainStore && ing.ingredient_left != null) {
      const stockQty = new Prisma.Decimal(ing.ingredient_left);
      await prisma.stockLevel.upsert({
        where: {
          ingredientId_locationId: {
            ingredientId: localIng.id,
            locationId: mainStore.id
          }
        },
        update: {
          quantity: stockQty
        },
        create: {
          ingredientId: localIng.id,
          locationId: mainStore.id,
          quantity: stockQty
        }
      });
    }
  }

  // ----------------------------------------------------
  // Import Products & Recipes
  // ----------------------------------------------------
  console.log('Importing products...');
  let importedProducts = 0;
  let importedRecipes = 0;

  for (const prod of posterProducts) {
    // Determine Department
    const catName = String(prod.category_name || '').toUpperCase();
    const prodName = String(prod.product_name || '').toUpperCase();
    let department: 'RESTAURANT' | 'BAR' | 'BILLIARDS' | 'PLAYSTATION' = 'RESTAURANT';
    
    if (catName.includes('BILLIARD') || prodName.includes('BILLIARD')) {
      department = 'BILLIARDS';
    } else if (catName.includes('PLAYSTATION') || catName.includes('PS5') || prodName.includes('PLAYSTATION') || prodName.includes('PS5')) {
      department = 'PLAYSTATION';
    } else if (catName.includes('DRINK') || catName.includes('BAR') || catName.includes('BEVERAGE') || catName.includes('JUICE') || catName.includes('SOFT')) {
      department = 'BAR';
    }

    // Determine Station
    const stationId = department === 'BAR' ? barStation?.id : kitchenStation?.id;

    // Price
    const spotPrice = Object.values(prod.price || {})[0] || '0';
    const priceCents = parseInt(String(spotPrice));

    // Category
    let menuCategoryId = prod.menu_category_id && prod.menu_category_id !== '0' ? String(prod.menu_category_id) : null;
    if (menuCategoryId === '80') {
      menuCategoryId = '125';
    }
    if (menuCategoryId) {
      // Ensure category exists
      const catExists = await prisma.category.findUnique({ where: { id: menuCategoryId } });
      if (!catExists) {
        // Create dummy category if missing
        await prisma.category.create({
          data: { id: menuCategoryId, name: prod.category_name || 'Uncategorized' }
        });
      }
    }

    // If category is not set, we assign to a default category
    let finalCategoryId = menuCategoryId;
    if (!finalCategoryId) {
      const defaultCat = await prisma.category.findFirst();
      if (defaultCat) {
        finalCategoryId = defaultCat.id;
      } else {
        const newCat = await prisma.category.create({ data: { name: 'General' } });
        finalCategoryId = newCat.id;
      }
    }

    // Upsert MenuItem
    const menuItem = await prisma.menuItem.upsert({
      where: { id: String(prod.product_id) },
      update: {
        name: prod.product_name,
        priceCents,
        sku: prod.barcode || null,
        categoryId: finalCategoryId,
        department,
        stationId: stationId || null,
      },
      create: {
        id: String(prod.product_id),
        name: prod.product_name,
        priceCents,
        sku: prod.barcode || null,
        categoryId: finalCategoryId,
        department,
        stationId: stationId || null,
        taxRateId: defaultTaxRate?.id || null,
        isActive: prod.hidden !== '1',
      }
    });

    importedProducts++;

    // Modifiers & Variants Import
    // 1. Group Modifications (extras, sizes, optional components)
    if (prod.group_modifications && prod.group_modifications.length > 0) {
      for (const group of prod.group_modifications) {
        const groupId = String(group.dish_modification_group_id);
        
        // Upsert ModifierGroup
        await prisma.modifierGroup.upsert({
          where: { id: groupId },
          update: {
            name: group.name,
            minSelect: group.num_min ?? 0,
            maxSelect: group.num_max ?? 1,
            isActive: group.is_deleted !== 1,
          },
          create: {
            id: groupId,
            name: group.name,
            minSelect: group.num_min ?? 0,
            maxSelect: group.num_max ?? 1,
            isActive: group.is_deleted !== 1,
          }
        });

        // Upsert Modifiers in this group
        for (const opt of group.modifications || []) {
          const modId = String(opt.dish_modification_id);
          const priceDeltaCents = Math.round(parseFloat(String(opt.price || 0)) * 100);
          
          await prisma.modifier.upsert({
            where: { id: modId },
            update: {
              groupId,
              name: opt.name,
              priceDeltaCents,
              sortOrder: opt.sort_order ?? 0,
            },
            create: {
              id: modId,
              groupId,
              name: opt.name,
              priceDeltaCents,
              sortOrder: opt.sort_order ?? 0,
              isActive: true,
            }
          });
        }

        // Link MenuItem to ModifierGroup
        await prisma.itemModifierGroup.upsert({
          where: {
            itemId_groupId: {
              itemId: menuItem.id,
              groupId
            }
          },
          update: {},
          create: {
            itemId: menuItem.id,
            groupId
          }
        });
      }
    }

    // 2. Direct Modifications (Variants on the product, e.g. for Playstation / size variants)
    if (prod.modifications && prod.modifications.length > 0 && !(prod.group_modifications && prod.group_modifications.length > 0)) {
      const varGroupId = `var_${menuItem.id}`;
      
      // Create a virtual "Variants" modifier group
      await prisma.modifierGroup.upsert({
        where: { id: varGroupId },
        update: {
          name: 'Variants',
          minSelect: 1,
          maxSelect: 1,
          isActive: true,
        },
        create: {
          id: varGroupId,
          name: 'Variants',
          minSelect: 1,
          maxSelect: 1,
          isActive: true,
        }
      });

      for (const mod of prod.modifications) {
        const modId = String(mod.modificator_id);
        const spotPrice = (Object.values(mod.spots || {})[0] as any)?.price || (mod.spots as any)?.[0]?.price || '0';
        const optionPriceCents = parseInt(String(spotPrice));
        const priceDeltaCents = optionPriceCents - menuItem.priceCents;

        await prisma.modifier.upsert({
          where: { id: modId },
          update: {
            groupId: varGroupId,
            name: mod.modificator_name,
            priceDeltaCents,
          },
          create: {
            id: modId,
            groupId: varGroupId,
            name: mod.modificator_name,
            priceDeltaCents,
            isActive: true,
          }
        });
      }

      // Link MenuItem to ModifierGroup
      await prisma.itemModifierGroup.upsert({
        where: {
          itemId_groupId: {
            itemId: menuItem.id,
            groupId: varGroupId
          }
        },
        update: {},
        create: {
          itemId: menuItem.id,
          groupId: varGroupId
        }
      });
    }

    // Recipe Import (for composite dishes with ingredients)
    if (prod.type === '2' && prod.ingredients && prod.ingredients.length > 0) {
      // Create Recipe
      const recipeName = `${menuItem.name} Recipe`;
      const recipe = await prisma.recipe.upsert({
        where: { menuItemId: menuItem.id },
        update: {
          name: recipeName,
          deductLocationName: department === 'BAR' ? 'Bar' : 'Kitchen',
        },
        create: {
          menuItemId: menuItem.id,
          name: recipeName,
          deductLocationName: department === 'BAR' ? 'Bar' : 'Kitchen',
        }
      });

      // Clear existing lines to prevent duplicates
      await prisma.recipeLine.deleteMany({ where: { recipeId: recipe.id } });

      // Create RecipeLines
      for (const ing of prod.ingredients) {
        const localIngId = String(ing.ingredient_id);
        
        // Verify ingredient exists locally
        const ingExists = await prisma.ingredient.findUnique({ where: { id: localIngId } });
        if (ingExists) {
          await prisma.recipeLine.create({
            data: {
              recipeId: recipe.id,
              ingredientId: localIngId,
              quantity: new Prisma.Decimal(ing.structure_brutto || '0'),
            }
          });
        }
      }

      importedRecipes++;
    }
  }

  console.log('Poster POS Menu Import completed.');
  console.log(`Summary:`);
  console.log(`- Menu Categories Imported/Updated: ${posterCategories.length}`);
  console.log(`- Inventory Ingredients Imported/Updated: ${posterIngredients.length}`);
  console.log(`- Menu Items Imported/Updated: ${importedProducts}`);
  console.log(`- Recipes Imported/Linked: ${importedRecipes}`);
}

main()
  .catch((e) => {
    console.error('Poster POS Import failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
