
let currentStockListStatsId = null;

document.addEventListener('DOMContentLoaded', function() {
    if (!requireAuth()) return;
    
    const user = getCurrentUser();
    if (user && document.getElementById('username-display')) {
        document.getElementById('username-display').textContent = user.username;
    }
    
    loadMyStockLists();
    
    const createForm = document.getElementById('create-stocklist-form');
    if (createForm) {
        createForm.addEventListener('submit', handleCreateStockList);
    }
    
    const addStockForm = document.getElementById('add-stock-form');
    if (addStockForm) {
        addStockForm.addEventListener('submit', handleAddStockToList);
    }
});

function switchTab(tabName) {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    event.target.classList.add('active');
    
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
    });
    document.getElementById(tabName).classList.add('active');
    
    if (tabName === 'my-lists') {
        loadMyStockLists();
    } else if (tabName === 'accessible-lists') {
        loadAccessibleStockLists();
    }
}

async function loadMyStockLists() {
    const grid = document.getElementById('stocklist-grid');
    if (!grid) return;
    
    grid.innerHTML = '<p class="text-muted">Loading stock lists...</p>';
    
    try {
        const stockLists = await StockListAPI.getStockLists();
        
        if (stockLists.length === 0) {
            grid.innerHTML = '<p class="text-muted">No stock lists yet. Create your first list!</p>';
            return;
        }
        
        grid.innerHTML = stockLists.map(list => `
            <div class="stocklist-card">
                <h3>List #${list.stock_list_id}</h3>
                <div class="stat-item">
                    <span class="stat-label">Visibility</span>
                    <span class="stat-value">${list.visibility || 'private'}</span>
                </div>
                <div class="stat-item">
                    <span class="stat-label">Items</span>
                    <span class="stat-value">${(list.items || []).length}</span>
                </div>
                <div class="mt-2" style="display: flex; gap: 10px; flex-wrap: wrap;">
                    <button class="btn btn-primary" onclick="viewStockListDetails(${list.stock_list_id})" style="flex: 1; min-width: 120px;">
                        View Details
                    </button>
                    <button class="btn btn-danger" onclick="deleteStockList(${list.stock_list_id})" style="flex: 1; min-width: 120px; background-color: #ef4444; border-color: #ef4444;">
                        Delete List
                    </button>
                </div>
            </div>
        `).join('');
    } catch (error) {
        
        grid.innerHTML = '<p class="text-muted">Failed to load stock lists.</p>';
    }
}

async function loadAccessibleStockLists() {
    const grid = document.getElementById('accessible-lists-grid');
    if (!grid) return;
    
    grid.innerHTML = '<p class="text-muted">Loading accessible stock lists...</p>';
    
    try {
        const stockLists = await StockListAPI.getAccessibleStockLists();
        
        if (stockLists.length === 0) {
            grid.innerHTML = '<p class="text-muted">No accessible stock lists.</p>';
            return;
        }
        
        grid.innerHTML = stockLists.map(list => `
            <div class="stocklist-card">
                <h3>List #${list.stock_list_id}</h3>
                <div class="stat-item">
                    <span class="stat-label">Visibility</span>
                    <span class="stat-value">${list.visibility || 'private'}</span>
                </div>
                <div class="stat-item">
                    <span class="stat-label">Creator</span>
                    <span class="stat-value">${list.creator || list.username || 'Unknown'}</span>
                </div>
                <button class="btn btn-primary btn-block mt-2" onclick="viewStockListDetails(${list.stock_list_id})">
                    View Details
                </button>
            </div>
        `).join('');
    } catch (error) {
        
        grid.innerHTML = '<p class="text-muted">Failed to load accessible stock lists.</p>';
    }
}

function viewAccessibleLists() {
    switchTab('accessible-lists');
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('active');
        if (btn.textContent.includes('Accessible')) {
            btn.classList.add('active');
        }
    });
}

async function handleCreateStockList(e) {
    e.preventDefault();
    
    const visibility = document.getElementById('stocklist-visibility').value;
    
    try {
        await StockListAPI.createStockList(visibility);
        closeModal('create-stocklist-modal');
        document.getElementById('create-stocklist-form').reset();
        loadMyStockLists();
        alert('Stock list created successfully!');
    } catch (error) {
        
        alert('Failed to create stock list: ' + error.message);
    }
}

async function viewStockListDetails(stockListId) {
    const modal = document.getElementById('stocklist-details-modal');
    const title = document.getElementById('stocklist-details-title');
    const content = document.getElementById('stocklist-details-content');
    
    if (!modal || !title || !content) return;
    
    title.textContent = `Stock List #${stockListId} Details`;
    content.innerHTML = '<p class="loading">Loading stock list details...</p>';
    
    try {
        const stockList = await StockListAPI.getStockListDetails(stockListId);
        
        const user = getCurrentUser();
        const isOwner = stockList.username === user.username;
        
        content.innerHTML = `
            <div class="stocklist-details">
                <div class="stat-item">
                    <span class="stat-label">Stock List ID</span>
                    <span class="stat-value">#${stockList.stock_list_id}</span>
                </div>
                <div class="stat-item">
                    <span class="stat-label">Visibility</span>
                    <span class="stat-value">${stockList.visibility || 'private'}</span>
                </div>
                ${isOwner ? `
                    <div class="mt-3 mb-3">
                        <button class="btn btn-primary" onclick="showAddStockModal(${stockList.stock_list_id})">+ Add Stock</button>
                        <button class="btn btn-danger" onclick="deleteStockList(${stockList.stock_list_id})" style="margin-left: 10px;">Delete List</button>
                    </div>
                ` : ''}
                <div class="mt-3 mb-3">
                    <button class="btn btn-info" onclick="showStockListStatistics(${stockList.stock_list_id})">View Statistics</button>
                </div>
                <h4 class="mt-3">Items</h4>
                ${stockList.items && stockList.items.length > 0 ? `
                    <table class="table">
                        <thead>
                            <tr>
                                <th>Symbol</th>
                                <th>Shares</th>
                                <th>Latest Price</th>
                                <th>Value</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${stockList.items.map(item => `
                                <tr>
                                    <td>${item.symbol}</td>
                                    <td>${formatNumber(item.shares || 0)}</td>
                                    <td>$${formatNumber(item.latest_price || 0)}</td>
                                    <td>$${formatNumber(item.value || 0)}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                        <tfoot>
                            <tr style="font-weight: bold; border-top: 2px solid var(--border-color);">
                                <td colspan="3" style="text-align: right;">Total Value:</td>
                                <td>$${formatNumber(stockList.total_value || 0)}</td>
                            </tr>
                        </tfoot>
                    </table>
                ` : '<p class="text-muted">No items in this list yet. Add your first stock!</p>'}
            </div>
        `;
        
        showModal('stocklist-details-modal');
    } catch (error) {
        
        content.innerHTML = '<p class="text-muted">Failed to load stock list details.</p>';
    }
}

function showCreateStockListModal() {
    document.getElementById('create-stocklist-form').reset();
    showModal('create-stocklist-modal');
}

function showAddStockModal(stockListId) {
    document.getElementById('add-stock-list-id').value = stockListId;
    document.getElementById('add-stock-form').reset();
    document.getElementById('add-stock-list-id').value = stockListId;
    showModal('add-stock-modal');
}

async function handleAddStockToList(e) {
    e.preventDefault();
    
    const stockListId = parseInt(document.getElementById('add-stock-list-id').value);
    const symbol = document.getElementById('add-stock-symbol').value.toUpperCase().trim();
    const shares = parseFloat(document.getElementById('add-stock-shares').value);
    
    if (!symbol || !shares) {
        alert('Please fill in all fields.');
        return;
    }
    
    try {
        await StockListAPI.addStockToList(stockListId, symbol, shares);
        closeModal('add-stock-modal');
        alert('Stock added to list successfully!');
        viewStockListDetails(stockListId);
        loadMyStockLists();
    } catch (error) {
        
        alert('Failed to add stock: ' + error.message);
    }
}

function showModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.add('active');
    }
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.remove('active');
    }
}

window.addEventListener('click', function(e) {
    if (e.target.classList.contains('modal')) {
        e.target.classList.remove('active');
    }
});

function formatNumber(num) {
    return num.toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}


async function showStockListStatistics(stockListId) {
    currentStockListStatsId = stockListId;
    const modal = document.getElementById('stocklist-statistics-modal');
    const content = document.getElementById('stocklist-statistics-content');
    const startInput = document.getElementById('stocklist-stats-start-date');
    const endInput = document.getElementById('stocklist-stats-end-date');
    const title = document.getElementById('stocklist-statistics-title');
    
    if (!modal || !content || !startInput || !endInput) return;
    
    if (title) {
        title.textContent = `Stock List #${stockListId} Statistics`;
    }
    startInput.value = '';
    endInput.value = '';
    content.innerHTML = '<p class="loading">Loading statistics...</p>';
    showModal('stocklist-statistics-modal');
    await loadStockListStatistics();
}

async function loadStockListStatistics() {
    if (!currentStockListStatsId) return;
    
    const content = document.getElementById('stocklist-statistics-content');
    const startDate = document.getElementById('stocklist-stats-start-date').value || null;
    const endDate = document.getElementById('stocklist-stats-end-date').value || null;
    
    if (!content) return;
    
    content.innerHTML = '<p class="loading">Loading statistics...</p>';
    
    try {
        const stats = await StockListAPI.getStockListStatistics(currentStockListStatsId, startDate, endDate);
        
        if (!stats || !stats.symbols || stats.symbols.length === 0) {
            content.innerHTML = '<p class="text-muted">No stocks in this list.</p>';
            return;
        }
        
        let html = `
            <div class="stat-grid mb-3">
                <div class="stat-item">
                    <span class="stat-label">Stock List</span>
                    <span class="stat-value">#${stats.stock_list_id || currentStockListStatsId}</span>
                </div>
                <div class="stat-item">
                    <span class="stat-label">Visibility</span>
                    <span class="stat-value text-capitalize">${stats.visibility || 'private'}</span>
                </div>
                <div class="stat-item">
                    <span class="stat-label">Creator</span>
                    <span class="stat-value">${stats.creator || 'Unknown'}</span>
                </div>
            </div>
        `;
        
        if (stats.message) {
            html += `<div class="alert">${stats.message}</div>`;
        }
        
        if (stats.stocks && stats.stocks.length > 0) {
            html += `
                <h4>Stock Statistics</h4>
                <table class="table">
                    <thead>
                        <tr>
                            <th>Symbol</th>
                            <th>COV</th>
                            <th>Beta</th>
                            <th>Mean</th>
                            <th>Std Dev</th>
                            <th>Data Points</th>
                            <th>Notes</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${stats.stocks.map(stock => `
                            <tr>
                                <td><strong>${stock.symbol}</strong></td>
                                <td>${stock.coefficient_of_variation !== null ? stock.coefficient_of_variation.toFixed(4) : 'N/A'}</td>
                                <td>${stock.beta !== null ? stock.beta.toFixed(4) : 'N/A'}</td>
                                <td>${stock.mean !== null ? '$' + formatNumber(stock.mean) : 'N/A'}</td>
                                <td>${stock.std_dev !== null ? '$' + formatNumber(stock.std_dev) : 'N/A'}</td>
                                <td>${stock.data_points || 0}</td>
                                <td>${stock.message ? `<small class="text-muted">${stock.message}</small>` : ''}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            `;
        } else {
            html += '<p class="text-muted">Not enough data to compute stock statistics.</p>';
        }
        
        if (stats.correlation_matrix && stats.correlation_matrix.length > 0) {
            html += '<h4 class="mt-4">Correlation Matrix</h4>';
            html += '<div style="overflow-x: auto;"><table class="table"><thead><tr><th></th>';
            stats.symbols.forEach(symbol => {
                html += `<th>${symbol}</th>`;
            });
            html += '</tr></thead><tbody>';
            stats.correlation_matrix.forEach(row => {
                html += `<tr><td><strong>${row.symbol}</strong></td>`;
                row.correlations.forEach(value => {
                    html += `<td>${value !== null ? value.toFixed(3) : 'N/A'}</td>`;
                });
                html += '</tr>';
            });
            html += '</tbody></table></div>';
        } else {
            html += '<p class="text-muted">Not enough overlapping data to compute correlation matrix.</p>';
        }
        
        content.innerHTML = html;
    } catch (error) {
        
        content.innerHTML = `<p class="text-muted">Failed to load statistics: ${error.message}</p>`;
    }
}

function updateStockListStatistics() {
    loadStockListStatistics();
}

async function deleteStockList(stockListId) {
    if (!confirm(`Are you sure you want to delete Stock List #${stockListId}? This action cannot be undone.`)) {
        return;
    }
    
    try {
        await StockListAPI.deleteStockList(stockListId);
        closeModal('stocklist-details-modal');
        alert('Stock list deleted successfully!');
        loadMyStockLists();
        const accessibleTab = document.getElementById('accessible-lists');
        if (accessibleTab && accessibleTab.classList.contains('active')) {
            loadAccessibleStockLists();
        }
    } catch (error) {
        
        alert('Failed to delete stock list: ' + error.message);
    }
}

window.switchTab = switchTab;
window.viewAccessibleLists = viewAccessibleLists;
window.viewStockListDetails = viewStockListDetails;
window.showCreateStockListModal = showCreateStockListModal;
window.showAddStockModal = showAddStockModal;
window.showStockListStatistics = showStockListStatistics;
window.updateStockListStatistics = updateStockListStatistics;
window.closeModal = closeModal;
window.deleteStockList = deleteStockList;

