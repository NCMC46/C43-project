const API_BASE = 'http://34.42.29.160:3000/api';


function getAuthToken() {
    return localStorage.getItem('auth_token');
}

function getCurrentUser() {
    const userStr = localStorage.getItem('current_user');
    if (!userStr) return null;
    return JSON.parse(userStr);
}

function setCurrentUser(user) {
    localStorage.setItem('current_user', JSON.stringify(user));
    if (user.token) {
        localStorage.setItem('auth_token', user.token);
    } else {
        localStorage.setItem('auth_token', 'mock_token');
    }
}

function clearAuth() {
    localStorage.removeItem('current_user');
    localStorage.removeItem('auth_token');
}

function isAuthenticated() {
    return getCurrentUser() !== null;
}

function requireAuth() {
    if (!isAuthenticated()) {
        window.location.href = 'index.html';
        return false;
    }
    return true;
}

async function apiRequest(endpoint, options = {}) {
    const url = `${API_BASE}${endpoint}`;
    const token = getAuthToken();
    const user = getCurrentUser();
    
    const headers = {
        'Content-Type': 'application/json'
    };
    
    if (user && user.username) {
        headers['x-username'] = user.username;
    }
    
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }
    
    if (options.headers) {
        Object.assign(headers, options.headers);
    }
    
    const response = await fetch(url, {
        ...options,
        headers
    });
    
    if (!response.ok) {
        let errorMsg = `Request failed: ${response.status}`;
        const data = await response.json().catch(() => null);
        if (data && data.message) {
            errorMsg = data.message;
        }
        throw new Error(errorMsg);
    }
    
    return await response.json();
}

const AuthAPI = {
    login: async function(username, password) {
        const user = await apiRequest('/auth/login', {
            method: 'POST',
            body: JSON.stringify({ username, password })
        });
        setCurrentUser(user);
        return user;
    },
    
    async register(username, password) {
        const user = await apiRequest('/auth/register', {
            method: 'POST',
            body: JSON.stringify({ username, password })
        });
        setCurrentUser(user);
        return user;
    },
    
    logout() {
        clearAuth();
    }
};

function logout() {
    AuthAPI.logout();
    window.location.href = 'index.html';
}

const PortfolioAPI = {
    getPortfolios: async () => apiRequest('/portfolios'),
    
    async createPortfolio(initialCash) {
        return await apiRequest('/portfolios', {
            method: 'POST',
            body: JSON.stringify({ initial_cash: initialCash })
        });
    },
    
    getPortfolioDetails(portfolioId) {
        return apiRequest(`/portfolios/${portfolioId}`);
    },
    
    async getPortfolioStatistics(portfolioId, startDate, endDate) {
        let url = `/portfolios/${portfolioId}/statistics`;
        if (startDate || endDate) {
            const parts = [];
            if (startDate) parts.push('start_date=' + encodeURIComponent(startDate));
            if (endDate) parts.push('end_date=' + encodeURIComponent(endDate));
            url += '?' + parts.join('&');
        }
        return await apiRequest(url);
    },
    
    getStockHistory: async function(portfolioId, symbol, interval) {
        const intv = interval || 'all';
        return await apiRequest(`/portfolios/${portfolioId}/holdings/${symbol}/history?interval=${intv}`);
    },
    
    async getStockPredictions(portfolioId, symbol, days) {
        if (!days) days = 30;
        return await apiRequest(`/portfolios/${portfolioId}/holdings/${symbol}/predictions?days=${days}`);
    },
    
    buyStock(portfolioId, symbol, shares, price) {
        return apiRequest(`/portfolios/${portfolioId}/buy`, {
            method: 'POST',
            body: JSON.stringify({ symbol, shares, price })
        });
    },
    
    async sellStock(portfolioId, symbol, shares, price) {
        return await apiRequest(`/portfolios/${portfolioId}/sell`, {
            method: 'POST',
            body: JSON.stringify({ symbol, shares, price })
        });
    },
    
    depositCash: async (portfolioId, amount) => {
        return await apiRequest(`/portfolios/${portfolioId}/deposit`, {
            method: 'POST',
            body: JSON.stringify({ amount })
        });
    },
    
    async withdrawCash(portfolioId, amount) {
        return await apiRequest(`/portfolios/${portfolioId}/withdraw`, {
            method: 'POST',
            body: JSON.stringify({ amount })
        });
    }
};

const StockListAPI = {
    getStockLists() {
        return apiRequest('/stocklists');
    },
    
    createStockList: async function(visibility) {
        return await apiRequest('/stocklists', {
            method: 'POST',
            body: JSON.stringify({ visibility })
        });
    },
    
    async getAccessibleStockLists() {
        const lists = await apiRequest('/stocklists/accessible');
        return lists.map(list => ({
            ...list,
            username: list.creator || list.username
        }));
    },
    
    getStockListDetails(stockListId) {
        return apiRequest(`/stocklists/${stockListId}`);
    },
    
    addStockToList: async (stockListId, symbol, shares) => {
        return await apiRequest(`/stocklists/${stockListId}/add-stock`, {
            method: 'POST',
            body: JSON.stringify({ symbol, shares })
        });
    },
    
    async getStockListStatistics(stockListId, startDate, endDate) {
        let url = `/stocklists/${stockListId}/statistics`;
        if (startDate || endDate) {
            const parts = [];
            if (startDate) parts.push('start_date=' + encodeURIComponent(startDate));
            if (endDate) parts.push('end_date=' + encodeURIComponent(endDate));
            url += '?' + parts.join('&');
        }
        return await apiRequest(url);
    },
    
    deleteStockList(stockListId) {
        return apiRequest(`/stocklists/${stockListId}`, {
            method: 'DELETE'
        });
    }
};

const FriendsAPI = {
    getFriends: async () => apiRequest('/friends'),
    
    async sendFriendRequest(username) {
        return await apiRequest('/friends/request', {
            method: 'POST',
            body: JSON.stringify({ target: username })
        });
    },
    
    getIncomingRequests() {
        return apiRequest('/friends/requests/incoming');
    },
    
    async getOutgoingRequests() {
        return await apiRequest('/friends/requests/outgoing');
    },
    
    acceptFriendRequest: async function(fromUsername) {
        return await apiRequest('/friends/accept', {
            method: 'POST',
            body: JSON.stringify({ from: fromUsername })
        });
    },
    
    async rejectFriendRequest(fromUsername) {
        return await apiRequest('/friends/reject', {
            method: 'POST',
            body: JSON.stringify({ from: fromUsername })
        });
    },
    
    removeFriend(friendUsername) {
        return apiRequest(`/friends/${friendUsername}`, {
            method: 'DELETE'
        });
    }
};

const ReviewsAPI = {
    getReviews(stockListId) {
        return apiRequest(`/stocklists/${stockListId}/reviews`);
    },
    
    async saveReview(stockListId, content) {
        return await apiRequest(`/stocklists/${stockListId}/reviews`, {
            method: 'POST',
            body: JSON.stringify({ content })
        });
    },
    
    deleteReview: async (stockListId, reviewId) => {
        return await apiRequest(`/stocklists/${stockListId}/reviews/${reviewId}`, {
            method: 'DELETE'
        });
    }
};

const DashboardAPI = {
    getDashboardStats: () => apiRequest('/dashboard/stats')
};

const StockDataAPI = {
    async recordStockData(symbol, timestamp, open, high, low, close, volume) {
        return await apiRequest('/stocks', {
            method: 'POST',
            body: JSON.stringify({
                symbol: symbol,
                timestamp: timestamp,
                open: parseFloat(open),
                high: parseFloat(high),
                low: parseFloat(low),
                close: parseFloat(close),
                volume: parseInt(volume)
            })
        });
    }
};

if (typeof window !== 'undefined') {
    window.AuthAPI = AuthAPI;
    window.PortfolioAPI = PortfolioAPI;
    window.StockListAPI = StockListAPI;
    window.FriendsAPI = FriendsAPI;
    window.ReviewsAPI = ReviewsAPI;
    window.DashboardAPI = DashboardAPI;
    window.StockDataAPI = StockDataAPI;
    window.getCurrentUser = getCurrentUser;
    window.isAuthenticated = isAuthenticated;
    window.requireAuth = requireAuth;
    window.logout = logout;
}
