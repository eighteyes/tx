#!/usr/bin/env bash
set -euo pipefail

# Find the git root directory
if ! git_root=$(git rev-parse --show-toplevel 2>/dev/null); then
    echo "Error: Not in a git repository"
    exit 1
fi

cd "$git_root"

# Check if there are any worktrees
if [ ! -d ".git/worktrees" ]; then
    echo "No worktrees found in this repository"
    exit 0
fi

echo "Rescuing worktrees in: $git_root"
echo ""

# Find all worktree admin directories
for wt_admin in .git/worktrees/*; do
    if [ ! -d "$wt_admin" ]; then
        continue
    fi
    
    wt_name=$(basename "$wt_admin")
    
    # Read the current gitdir file to find where the worktree thinks it is
    if [ ! -f "$wt_admin/gitdir" ]; then
        echo "⚠️  Skipping $wt_name: no gitdir file found"
        continue
    fi
    
    old_path=$(cat "$wt_admin/gitdir")
    
    # Extract the worktree path pattern from the old path
    # This handles paths like /workspace/repo/.ai/worktrees/name or /some/path/worktrees/name
    if [[ "$old_path" =~ (.*/)?(\.?[^/]+/worktrees/$wt_name)/?$ ]]; then
        worktree_suffix="${BASH_REMATCH[2]}"
        new_worktree_path="$git_root/$worktree_suffix"
    else
        echo "⚠️  Skipping $wt_name: couldn't parse worktree path pattern from '$old_path'"
        continue
    fi
    
    # Check if the worktree directory actually exists
    if [ ! -d "$new_worktree_path" ]; then
        echo "⚠️  Skipping $wt_name: directory not found at $new_worktree_path"
        continue
    fi
    
    # Update the gitdir file in .git/worktrees to point to the correct location
    echo "$new_worktree_path" > "$wt_admin/gitdir"
    
    # Update the .git file in the worktree to point to the correct gitdir
    echo "gitdir: $git_root/.git/worktrees/$wt_name" > "$new_worktree_path/.git"
    
    echo "✓ Fixed: $wt_name -> $new_worktree_path"
done

echo ""
echo "Done! Worktree status:"
git worktree list
