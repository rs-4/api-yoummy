import express from 'express';
import recipeRoute from './recipe.route.js';

const router = express.Router();

router.use('/recipe', recipeRoute);

export default router;
