import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

export async function OPTIONS() {
  return new Response(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    }
  });
}

export async function GET() {
  try {
    // Read the blog.yml config file
    const configPath = path.join(process.cwd(), 'src/content/config/blog.yml');
    const configContent = fs.readFileSync(configPath, 'utf8');
    const config = yaml.load(configContent);
    
    // Extract categories and format for PagesCMS
    const categories = config.categories || [];
    
    // Format categories for PagesCMS select field - using GitHub API format
    const formattedCategories = categories.map((category: any) => ({
      id: category.slug,
      name: category.name,
      login: category.slug
    }));
    
    return new Response(JSON.stringify({
      items: formattedCategories
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate', // Prevent caching
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization'
      }
    });
  } catch (error) {
    console.error('Error loading categories:', error);
    return new Response(JSON.stringify({
      error: 'Failed to load categories',
      categories: []
    }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization'
      }
    });
  }
}
