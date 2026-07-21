import { generateRoleKeywordsWithAI } from './src/ai-role-agent.js';

// Test search for Business Analyst and inspect raw titles from all scrapers before filtering
async function debugTitles() {
  const rawSearchKeywords = "Business Analyst";
  const userRequestedKeywords = [rawSearchKeywords];
  const expandedKeywords = generateRoleKeywordsWithAI(userRequestedKeywords);

  console.log('Expanded keywords:', expandedKeywords);
}

debugTitles();
