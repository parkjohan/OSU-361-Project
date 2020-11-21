const express = require('express');
const session = require('express-session');
const ingredientIcons = require('./ingredientIcons');
const handlebars = require('express-handlebars').create({ defaultLayout:'main' });
const PORT = process.env.PORT || 5000;
const app = express();
const bodyParser = require('body-parser');
app.use(bodyParser.urlencoded({extended: true}));
app.use(bodyParser.json());
const {Pool} = require('pg');
const pool = new Pool({
  connectionString: "postgres://qxtetfyciswbov:31134b5dcc9de86cf5f8f815858b9140d07cff36a764dfb7b90424c6804a5e38@ec2-3-211-176-230.compute-1.amazonaws.com:5432/d3u5cr9kigu0n5",
  ssl: {
    rejectUnauthorized: false
  }
});
app.engine('handlebars', handlebars.engine);
app.set('view engine', 'handlebars');
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(express.static(__dirname + '/public'));

app.use(session({
  secret:'secret',
  resave:true,
  saveUninitialized:true
}))
app.use(function(req, res, next){
  res.locals.session = req.session;
  next();
})

// Logan Kiser: potential frequently used queries
const querySelectAllSystemRecipes =       `SELECT * FROM recipes WHERE user_recipe = false`;

function getIngredientImage(type){
    if (type == "Meat") {
        return ingredientIcons.getMeatUrl();
    } else if (type == "Bread") {
        return ingredientIcons.getBreadUrl();
    } else if (type == "Vegetable") {
        return ingredientIcons.getCarrotUrl();
    } else if (type == "Milk") {
        return ingredientIcons.getMilkUrl();
    } else if (type == "Dairy") {
        return ingredientIcons.getCheeseUrl();
    } else if (type == "Sauce") {
        return ingredientIcons.getSauceUrl();
    }
    else {
        return ingredientIcons.getForkUrl();
    }
};

function get_rand_rgb(){
  const randomBetween = (min, max) => min + Math.floor(Math.random() * (max - min + 1));
  const r = randomBetween(0, 255);
  const g = randomBetween(0, 255);
  const b = randomBetween(0, 255);
  const rgb = `rgba(${r},${g},${b}, 1)`; // Collect all to a css color string
  return rgb
}

app.get('/', (req , res, next) => {
  res.render('homepage');
});

class ChooseRecipeMap extends Map{
  constructor(rows=Array){
    super();
    for(let row of rows){
      row.in_book = false;
      this.set(row.id, row)
    }
  }
  async checkUserRecipes(req){
    if(req.session.loggedin){
      var querySelectUserRecipesByUserId = {
        text: 'SELECT recipes_id FROM users_recipes WHERE users_id=$1',
        values: [req.session.user.id]
      };
      const rows_1 = await makeQuery(querySelectUserRecipesByUserId, true).catch(err=>{return Promise.reject(err)});
      var RECIPES_TO_SEND_FILTERED = this._setUserRecipes(rows_1);
      return Promise.resolve(RECIPES_TO_SEND_FILTERED);
    } else {
      return Promise.resolve(this);
    }
  }
  toSortedArray(){
    return Array.from(this.values()).sort(this._inRecipeBookCompare);
  }
  _setUserRecipes(user_recipe_rows){
    var RECIPES_TO_SEND_FILTERED = this;
    for(let row of user_recipe_rows){
      let recipe = RECIPES_TO_SEND_FILTERED.get(row.recipes_id);
      if(recipe != null){
        recipe.in_book = true;
        RECIPES_TO_SEND_FILTERED.set(row.recipes_id, recipe);
      }
      
      
    }
    return RECIPES_TO_SEND_FILTERED;
  }
  _inRecipeBookCompare(book1, book2){
    return book1.in_book - book2.in_book;
  }
}

app.get('/choose_recipe', async (req , res, next) => {
  var context = {};
  var all_recipes = await makeQuery(querySelectAllSystemRecipes, true).catch(err=>console.error(err));
  var RECIPES_MAP = new ChooseRecipeMap(all_recipes);
  RECIPES_MAP.checkUserRecipes(req).then((FILTERED)=>{
    context["recipes"] = FILTERED.toSortedArray();
    res.render('choose_recipe', context);
  }).catch(err=>console.error(err));

});

app.get('/get_ingredients', (req, res, next)=>{
  var context = {};
  if(req.query["recipes_id"]){
    var getIngredientsQuery = {
      text:'SELECT * FROM ingredients WHERE id IN (SELECT ingredients_id FROM recipes_ingredients WHERE recipes_id=$1)',
      values:[req.query["recipes_id"]]
    }
    makeQuery(getIngredientsQuery, true).then(rows=>{
      context.recipes_id = req.query["recipes_id"];
      context.ingredients = rows;
      res.send(context);
    }).catch(err=>console.error(err))
  } else {
    var queryGetAllIngredients = {
      text: 'SELECT * FROM ingredients'
    };
    makeQuery(queryGetAllIngredients, true).then(rows=>{
      
      for(let row of rows){
        row.color = getImpactColor(row.impact);
      };
      context.ingredients = rows;
      res.send(context);
    }).catch(err=>console.error(err));
  }
});

app.get('/add_recipe', (req, res, next)=>{
  if(req.query["recipe_id"] && req.session.loggedin){
    var addRecipeQuery = {
      text: `INSERT INTO users_recipes (users_id, recipes_id, date) VALUES ($1, $2, to_timestamp(${Date.now() / 1000.0}))
            ON CONFLICT ON CONSTRAINT users_recipes_pkey DO UPDATE SET date = EXCLUDED.date;`,
      values: [req.session.user.id, req.query["recipe_id"]]
    };
    var getRecipeQuery = {
      text: `SELECT * FROM recipes WHERE id=$1`,
      values: [req.query["recipe_id"]]
    };
    makeQuery(addRecipeQuery, false).then(()=>makeQuery(getRecipeQuery, true)).then(rows=>{
      res.send(rows[0]);
    }).catch(err=>console.error(err))
  } else {
    res.send(false);
  };
});

app.post('/add_to_recipes_global', (req, res, next)=>{
  var queryRecipeByName = {
    text:`SELECT * FROM recipes WHERE name=$1`,
    values:[req.body["userRecipeName"]]
  };
  var addUserRecipeGlobal = {
    text:`INSERT INTO recipes (name, type, user_recipe) VALUES ($1, $2, $3)`,
    values:[req.body["userRecipeName"], req.body["userRecipeType"], true]
  };
  makeQuery(queryRecipeByName, true).then(rows=>{
    if(rows.length > 0){
      res.send({"error":"Recipe name taken!"})
    } else {
      Promise.resolve()
    }
  }).then(()=>{makeQuery(addUserRecipeGlobal, false)}).then(()=>makeQuery(queryRecipeByName, true)).then(rows=>{
    var ingredients = [];
    var queries = [];
    for(let ingredient of req.body["ingredients"]){
      ingredients.push({
        "id":parseInt(ingredient[0]),
        "amount":ingredient[1].amount,
        "prep":ingredient[1].prep
      });
    }
    for(let ingredient of ingredients){
      queries.push(
        new Promise((resolve,reject)=>{
          return makeQuery({
            text: 'INSERT INTO recipes_ingredients (recipes_id, ingredients_id, amount, prep) VALUES ($1, $2, $3, $4) RETURNING *',
            values: [rows[0].id, ingredient.id, ingredient.amount, ingredient.prep]
          },true).then((rows)=>resolve(rows))
        })
      )
    }
    queries.push(new Promise((resolve,reject)=>{
      return makeQuery({
        text: `INSERT INTO users_recipes (users_id, recipes_id, date) VALUES ($1, $2, to_timestamp(${Date.now() / 1000.0})) RETURNING *`,
        values: [req.session.user.id, rows[0].id]
      },true).then((rows)=>resolve(rows))
    }))
    return Promise.all(queries).catch(err=>console.error(err));
  })
  .then(()=>{
    return makeQuery(queryRecipeByName, true)
  }
    ).then(rows=>{
      res.send(rows[0]);
    }).catch(err=>console.error(err))
})

app.get('/get_user_recipes', (req, res, next)=>{
  if(req.session["user"] == null){
    res.send(false);
  }else{
    pool.query('SELECT recipes_id FROM users_recipes WHERE users_id=$1', [req.session.user.id], (err, {rows})=>{
      if(err) {
        console.error(err)
        res.send(false);
      }
      res.send(rows);
    })
  }
})

app.get('/view_ingredients', async (req , res, next) => {
  // assign request header to convenient variable
  var recipe_id = req.query["recipe_id"];

  // get recipe info associated
  var queryRecipeById = {
    text: 'SELECT * FROM recipes WHERE id=$1',
    values: [recipe_id]
  }
  var recipes = await makeQuery(queryRecipeById, true);

  // get ingredients associated with recipe
  var queryIngredientsByRecipe = {
    text: `SELECT i.*, ri.amount, ri.prep 
          FROM recipes AS r 
          LEFT JOIN recipes_ingredients AS ri 
          ON (r.id = ri.recipes_id) 
          LEFT JOIN ingredients AS i 
          ON (ri.ingredients_id = i.id) 
          WHERE r.id = $1`,
    values: [recipe_id]
   }
   var ingredients = await makeQuery(queryIngredientsByRecipe, true);
  
  // assign data to context and render page
  context = {};
  context["ingredients"] = ingredients;
  context["recipe"] = recipes[0];
  res.render('view_ingredients', context);
});

app.get('/view_substitutes', (req, res, next) => {
  var ingredient = {};
  ingredient.id = req.query["ingredient"];
  ingredient.name = req.query["ingredientName"];
  var recipe = {}
  recipe.id = req.query["recipe"]
  recipe.name = req.query["recipeName"];

  var queryCurrIngredient = {
    text: 'SELECT * FROM ingredients WHERE id=$1',
    values: [ingredient.id]
  };

  makeQuery(queryCurrIngredient, true)
    .then(rows => getSubstitutes(rows))
    .then(rows => {renderSubstitutes(res, rows, recipe, ingredient);
    }).catch(err => {console.error(err)})
});

function getSubstitutes(rows)
{
  return new Promise((resolve, reject)=>{
    var query = {
      text: 'SELECT * FROM ingredients WHERE type=$1 AND impact<$2',
      values: [rows[0].type, rows[0].impact]
    }
    pool.query(query, (err, result)=>{
      if(err) reject(err)
      else resolve(result.rows);
    })
  })
};

function renderSubstitutes(res, rows, recipe, ingredient)
{
  context = {};
  context["recipe"] = recipe;
  context["ingredient"] = ingredient;
  if(rows.length > 0){
    var substitutes = [];
    for(i=0; i < rows.length; i++){
      substitutes[i] = {};
      substitutes[i].name = rows[i].name;
      substitutes[i].impact = rows[i].impact;
      substitutes[i].id = rows[i].id;
    }
    context["substitutes"] = substitutes;
  } else{
    context["message"] = 'No substitutions available!';
  }
  res.render('view_substitutes', context);
}

function getRandIconColor(){
    const randomBetween = (min, max) => min + Math.floor(Math.random() * (max - min + 1));
    const r = randomBetween(0, 255);
    const g = randomBetween(0, 255);
    const b = randomBetween(0, 255);
    const rgb = `rgba(${r},${g},${b}, 0.35)`; // Collect all to a css color string
    return rgb
};

app.get('/make_substitution', async (req, res, next) => {
  // make sure user is logged in
  if(req.session.loggedin){
    
    // define a few convenient variables
    var ingredient_id = req.query["ingredient"];
    var recipe_id = req.query["recipe_id"];
    var new_name = req.query["new_name"];
    var substitute_id = req.query["substitute"]; 

    // get all recipe info
    var queryRecipeById = {
      text: 'SELECT * FROM recipes WHERE id = $1',
      values: [recipe_id]
    };
    var recipe = await makeQuery(queryRecipeById, true);
    console.log(recipe);
    recipe = recipe[0];
    console.log(recipe);

    // get all ingredients associated with recipe
    var queryIngredientsByRecipe = {
      text: `SELECT i.*, ri.amount, ri.prep 
            FROM recipes AS r 
            LEFT JOIN recipes_ingredients AS ri 
            ON (r.id = ri.recipes_id) 
            LEFT JOIN ingredients AS i 
            ON (ri.ingredients_id = i.id) 
            WHERE r.id = $1`,
      values: [recipe_id]
    };
    var ingredients = await makeQuery(queryIngredientsByRecipe, true);

    // add skeleton in DB for new user recipe
    var addUserRecipeGlobal = {
      text:`INSERT INTO recipes (name, type, user_recipe) VALUES ($1, $2, $3)`,
      values:[new_name, recipe["type"], true]
    };
    await makeQuery(addUserRecipeGlobal, false)

    // get id of new recipe
    var queryRecipeByName = {
      text: 'SELECT id FROM recipes WHERE name = $1',
      values: new_name
    };
    new_recipe_id = await makeQuery(queryRecipeByName, true);

    // update recipes_ingredients table to link new recipe to ingredients
    for (let ing of ingredients) {
      
      // handle case where current ingredient is to be substituted FOR
      if (ing.id == ingredient_id) {
        var linkRecipeToIngredients = {
          text: 'INSERT INTO recipes_ingredients (recipes_id, ingredients_id) VALUES ($1, $2)',
          values: [new_recipe_id, substitute_id]
        }
        await makeQuery(linkRecipeToIngredients, false);
      }

      // handle case where current ingredient will remain in recipe
      else {
        var linkRecipeToIngredients = {
          text: 'INSERT INTO recipes_ingredients (recipes_id, ingredients_id) VALUES ($1, $2)',
          values: [new_recipe_id, ing["id"]]
        }
        await makeQuery(linkRecipeToIngredients, false);
      }
    }

    // update users_recipes to link recipe to user
    var linkRecipeToUser = {
      text: `INSERT INTO users_recipes (users_id, recipes_id, date) VALUES ($1, $2, to_timestamp(${Date.now() / 1000.0}))`,
      values: [req.session.user.id, new_recipe_id]
    }
    await makeQuery(linkRecipeToUser, false);
    
    // render my_recipes page
    var getRecipesQuery = {
      text: 'SELECT users_recipes.*, recipes.*, SUM(impact) as recipes_impact FROM recipes_ingredients '+
            'JOIN ingredients ON recipes_ingredients.ingredients_id=ingredients.id '+
            'JOIN users_recipes ON recipes_ingredients.recipes_id=users_recipes.recipes_id '+
            'JOIN recipes ON users_recipes.recipes_id=recipes.id '+
            'WHERE users_recipes.users_id=$1 '+
            'GROUP BY users_recipes.recipes_id, users_recipes.users_id, recipes.id ',
      values: [req.session.user.id]
    }
    var myRecipes = await makeQuery(getRecipesQuery, true);
    context = {};
    context["myRecipes"] = makeRecipesObject(myRecipes);
    res.render('my_recipes', context);


  } 
  // handle case where user is not logged in
  else {
    res.send(false);
  };
});

app.get('/build_recipe', async (req , res, next) => {
  var context = {};
  var ingredients = await makeQuery('SELECT * FROM ingredients', true);
  for(let ingredient of ingredients){
    // Uppercase first letter of ingredient type:
    ingredient.type = ingredient.type[0].toUpperCase() + ingredient.type.slice(1);
    ingredient.name = ingredient.name[0].toUpperCase() + ingredient.name.slice(1);
    ingredient.iconColor = getRandIconColor();
    ingredient.icon = getIngredientImage(ingredient.type);
    ingredient.color = getImpactColor(ingredient.impact);
  }
  context["ingredients"] = ingredients;
  res.render('build_recipe', context);
});

app.get('/my_recipes', (req , res, next) => {
  if(req.session["user"] == null){
    res.send("Error! Please log-in!")
  } else{
    var getRecipesQuery = {
      text: 'SELECT users_recipes.*, recipes.*, SUM(impact) as recipes_impact FROM recipes_ingredients '+
            'JOIN ingredients ON recipes_ingredients.ingredients_id=ingredients.id '+
            'JOIN users_recipes ON recipes_ingredients.recipes_id=users_recipes.recipes_id '+
            'JOIN recipes ON users_recipes.recipes_id=recipes.id '+
            'WHERE users_recipes.users_id=$1 '+
            'GROUP BY users_recipes.recipes_id, users_recipes.users_id, recipes.id ',
      values: [req.session.user.id]
    }
    if(req.query["recipe_id"]){
      var addRecipeQuery = {
        text: `INSERT INTO users_recipes (users_id, recipes_id, date) VALUES ($1, $2, to_timestamp(${Date.now() / 1000.0}))
              ON CONFLICT ON CONSTRAINT users_recipes_pkey DO UPDATE SET date = EXCLUDED.date;`,
        values: [req.session.user.id, req.query["recipe_id"]]
      }
      makeQuery(addRecipeQuery, false).then(()=>makeQuery(getRecipesQuery, true)).then(rows=>{
        renderMyRecipes(res, rows);
      }).catch(err=>{console.error(err)})
      
    } else if(req.query["delete_id"]){
      var deleteRecipeQuery = {
        text: `DELETE FROM users_recipes WHERE recipes_id=$1`,
        values: [req.query["delete_id"]]
      }
      make(deleteRecipeQuery, false).then(()=>makeQuery(getRecipesQuery, true)).then(rows=>{
        renderMyRecipes(res, rows);
      }).catch(err=>{console.error(err)})
    } else {
      makeQuery(getRecipesQuery, true).then(rows=>{
        renderMyRecipes(res, rows);
      }).catch(err=>{console.error(err)})
    }
  }
});

function renderMyRecipes(res, rows){
  context = {};
  context["myRecipes"] = makeRecipesObject(rows);
  res.render("my_recipes", context);
};

function makeQuery(query, returnRows){
  return new Promise((resolve, reject)=>{
    pool.query(query, (err, result)=>{
      if(err) reject(err)
      else{
        if(returnRows){
          resolve(result.rows);
        }
        else{
          resolve(true);
        }
      }
    })
  })
};

function getImpactColor(impact){
  var impact_color = ''
  if(impact == null){
    impact_color = 'secondary'
  } else {
    if(impact > 8000){
      impact_color = 'danger'
    } else if (impact < 8000 && impact > 3000){
      impact_color = 'warning'
    } else if (impact < 3000){
      impact_color = 'success'
    }
  }
  return impact_color
}

function makeRecipesObject(rows){
  var recipes = [];
  for(i=0; i < rows.length; i++){
    recipes[i] = {};
    recipes[i].name = rows[i].name;
    if(recipes[i].hasOwnProperty("date") && recipes[i].date != null){
      recipes[i].date = rows[i].date.toLocaleString();
    }
    recipes[i].impact = rows[i].recipes_impact;
    recipes[i].impact_color = getImpactColor(recipes[i].impact);
    recipes[i].id = rows[i].recipes_id;
    if(rows[i].hasOwnProperty("type")){
      recipes[i].type = rows[i].type;
    } else{
      recipes[i].type = ""
    }
  }
  return recipes
}

var register = async function(req, res){
  var username = req.body.username;
  var password = req.body.password;
  var checkUser = {text:'SELECT * FROM users WHERE username=$1', values:[username]};
  var registerUser = {
    text:'INSERT INTO users (username, password, color) VALUES ($1, $2, $3)',
    values:[username, password, get_rand_rgb()]
  };
  pool.query(checkUser, (err, {rows})=>{
    if(err) console.error(err)
    else{
      if(rows.length > 0){
        res.send({
          "code":409,
          "failed":"Username already registered"
        })
      } else{
        makeQuery(registerUser, false).then(()=>makeQuery(checkUser, true)).then(rows=>{
          if(rows[0].username == username){
            req.session.loggedin = true;
            req.session.user = {
              username: rows[0].username, 
              color: rows[0].color,
              id: rows[0].id
            };
            res.redirect('/');
          }
        }).catch(err=>console.error(err))
      }
    }
  })
}

var login = async function(req, res){
  var username = req.body.username;
  var password = req.body.password;
  pool.query({text:"SELECT * FROM USERS WHERE username=$1", values:[username]}, (err, {rows})=>{
    if(err){
      console.error(err)
    } else{
      if(rows.length == 0){
        res.send({
          "code":206,
          "success":"Invalid E-mail"
        }); 
      } else{
        if(rows[0].password != password){
          res.send({
            "code":204,
            "success":"Bad Credentials, Please Try Again"
          })
        } else{
          req.session.loggedin = true;
          req.session.user = {
            username: rows[0].username,
            color: rows[0].color,
            id: rows[0].id
          };
          res.redirect('/');
        };
      };
    };
  });
};

app.post('/register', register);
app.post('/login', login);

app.get('/logout', function(req, res, next){
  if(req.session){
    req.session.destroy(function(err){
      if(err){
        return next(err);
      } else{
        return res.redirect('/');
      }
    })
  }
})

app.get('/new_user', function(req, res, next){
  res.render('new_user')
})

app.use(function(req,res){
  res.status(404);
  res.render('404');
});

app.use(function(err, req, res, next){
  console.error(err.stack);
  res.status(500);
  res.render('500');
});

app.listen(PORT, function(){
  console.log(`Listening on: ${ PORT }; press Ctrl-C to terminate.`);
});
