
document.addEventListener('DOMContentLoaded', function() {
    if (!requireAuth()) return;
    
    const user = getCurrentUser();
    if (user) {
        const usernameDisplay = document.getElementById('username-display');
        if (usernameDisplay) {
            usernameDisplay.textContent = user.username;
        }
    }
    
    loadDashboard();
});

async function loadDashboard() {
    try {
        const stats = await DashboardAPI.getDashboardStats();
        document.getElementById('portfolio-count').textContent = stats.portfolio_count || 0;
        document.getElementById('portfolio-value').textContent = `$${formatNumber(stats.portfolio_value || 0)}`;
        document.getElementById('stocklist-count').textContent = stats.stocklist_count || 0;
        document.getElementById('shared-list-count').textContent = stats.shared_list_count || 0;
        document.getElementById('friends-count').textContent = stats.friends_count || 0;
        document.getElementById('pending-requests').textContent = stats.pending_requests || 0;
        await loadRecentActivity();
    } catch (error) {
        
    }
}

async function loadRecentActivity() {
    const activityList = document.getElementById('recent-activity');
    if (!activityList) return;
    
    try {
        const portfolios = await PortfolioAPI.getPortfolios();
        const stockLists = await StockListAPI.getStockLists();
        const friends = await FriendsAPI.getFriends();
        
        const activities = [];
        
        portfolios.slice(0, 3).forEach(portfolio => {
            activities.push({
                type: 'portfolio',
                message: `Portfolio ${portfolio.portfolio_id} has $${formatNumber(portfolio.cash_account)} cash`,
                time: 'Recently'
            });
        });
        
        stockLists.slice(0, 2).forEach(list => {
            activities.push({
                type: 'stocklist',
                message: `Stock list "${list.stock_list_id}" (${list.visibility})`,
                time: 'Recently'
            });
        });
        
        if (friends.length > 0) {
            activities.push({
                type: 'friend',
                message: `You have ${friends.length} friend${friends.length > 1 ? 's' : ''}`,
                time: 'Recently'
            });
        }
        
        if (activities.length === 0) {
            activityList.innerHTML = '<p class="text-muted">No recent activity.</p>';
            return;
        }
        
        activityList.innerHTML = activities.map(activity => `
            <div class="activity-item">
                <div>
                    <strong>${activity.type.charAt(0).toUpperCase() + activity.type.slice(1)}</strong>
                    <p class="text-muted">${activity.message}</p>
                </div>
                <span class="text-muted">${activity.time}</span>
            </div>
        `).join('');
    } catch (error) {
        
        activityList.innerHTML = '<p class="text-muted">Failed to load activity.</p>';
    }
}

function formatNumber(num) {
    return num.toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}




