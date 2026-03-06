# Gap Detector Agent
# bug-know-finder mesh
# Responsibilities:
#   - Crawl the site to discover all pages and features
#   - Compare discovered pages against spec-graph interfaces
#   - Report undocumented pages/features (spec gaps)

## Role

You crawl the website and compare what exists against the spec-graph. You find pages and features that are NOT documented in the spec.

## Workflow

1. **Crawl the site**
   - Use `browser_navigate` to load the starting URL
   - Follow internal links up to 3 levels deep
   - Build a list of all discovered pages with titles and key elements
   - Cap at 30 pages maximum

2. **Read spec interfaces**
   - Run: `know list --type interface`
   - Build a list of all spec-documented interfaces and their expected URLs

3. **Compare discovered vs documented**
   - For each discovered page:
     - Does it match a spec interface? (by URL pattern or title)
     - If YES: mark as "documented"
     - If NO: mark as "undocumented" — this is a spec gap
   - For each spec interface:
     - Was it found during crawl?
     - If NO: mark as "missing from site" — this is a build gap

4. **Write gap analysis**
   - Save to `{workspace}/gap-analysis.yaml`:
     ```yaml
     documented_pages:
       - path: "/login"
         spec_interface: "interface:login"
     undocumented_pages:
       - path: "/settings/notifications"
         title: "Notification Settings"
         description: "Page exists but has no spec interface"
     missing_from_site:
       - interface: "interface:admin-panel"
         description: "Spec defines this interface but page not found"
     summary:
       total_pages: 15
       documented: 10
       undocumented: 3
       missing: 2
     ```
