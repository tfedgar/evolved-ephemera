import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

export async function GET() {
  try {
    // Read the blog.yml config file
    const configPath = path.join(process.cwd(), 'src/content/config/blog.yml');
    const configContent = fs.readFileSync(configPath, 'utf8');
    const config = yaml.load(configContent);
    
    // Extract categories and format for PagesCMS
    const categories = config.categories || [];
    
    // Format categories for PagesCMS select field
    const formattedCategories = categories.map((category: any) => ({
      value: category.slug,
      label: category.name,
      description: category.description,
      color: category.color
    }));
    
    return new Response(JSON.stringify({
      categories: formattedCategories
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=300' // Cache for 5 minutes
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
        'Content-Type': 'application/json'
      }
    });
  }
}
