
document.addEventListener('DOMContentLoaded', function() {
    if (!requireAuth()) return;
    
    const user = getCurrentUser();
    const usernameDisplay = document.getElementById('username-display');
    if (user && usernameDisplay) {
        usernameDisplay.textContent = user.username;
    }
    
    loadPortfolios();
    
    const createForm = document.getElementById('create-portfolio-form');
    if (createForm) createForm.addEventListener('submit', handleCreatePortfolio);
    
    document.getElementById('buy-stock-form')?.addEventListener('submit', handleBuyStock);
    document.getElementById('sell-stock-form')?.addEventListener('submit', handleSellStock);
    document.getElementById('deposit-cash-form')?.addEventListener('submit', handleDepositCash);
    document.getElementById('withdraw-cash-form')?.addEventListener('submit', handleWithdrawCash);
});

async function loadPortfolios() {
    const portfolioList = document.getElementById('portfolio-list');
    if (!portfolioList) return;
    
    portfolioList.innerHTML = '<p class="text-muted">Loading portfolios...</p>';
    
    try {
        const portfolios = await PortfolioAPI.getPortfolios();
        
        if (portfolios.length === 0) {
            portfolioList.innerHTML = '<p class="text-muted">No portfolios yet. Create your first portfolio!</p>';
            return;
        }
        
        portfolioList.innerHTML = portfolios.map(portfolio => {
            return `<div class="portfolio-card">
                <h3>Portfolio #${portfolio.portfolio_id}</h3>
                <div class="stat-item">
                    <span class="stat-label">Cash Account</span>
                    <span class="stat-value">$${formatNumber(portfolio.cash_account || 0)}</span>
                </div>
                <div class="stat-item">
                    <span class="stat-label">Holdings</span>
                    <span class="stat-value">${(portfolio.holdings || []).length}</span>
                </div>
                <button class="btn btn-primary btn-block mt-2" onclick="viewPortfolioDetails(${portfolio.portfolio_id})">View Details</button>
            </div>`;
        }).join('');
    } catch (error) {
        portfolioList.innerHTML = '<p class="text-muted">Failed to load portfolios.</p>';
    }
}

async function handleCreatePortfolio(e) {
    e.preventDefault();
    const initialCash = parseFloat(document.getElementById('initial-cash').value) || 0;
    try {
        await PortfolioAPI.createPortfolio(initialCash);
        closeModal('create-portfolio-modal');
        document.getElementById('create-portfolio-form').reset();
        loadPortfolios();
        alert('Portfolio created successfully!');
    } catch (error) {
        alert('Failed to create portfolio: ' + error.message);
    }
}

async function viewPortfolioDetails(portfolioId) {
    const modal = document.getElementById('portfolio-details-modal');
    const title = document.getElementById('portfolio-details-title');
    const content = document.getElementById('portfolio-details-content');
    
    if (!modal || !title || !content) return;
    
    title.textContent = `Portfolio #${portfolioId} Details`;
    content.innerHTML = '<p class="loading">Loading portfolio details...</p>';
    
    try {
        const portfolio = await PortfolioAPI.getPortfolioDetails(portfolioId);
        
        content.innerHTML = `
            <div class="portfolio-details">
                <div class="stat-item">
                    <span class="stat-label">Portfolio ID</span>
                    <span class="stat-value">#${portfolio.portfolio_id}</span>
                </div>
                <div class="stat-item">
                    <span class="stat-label">Cash Account</span>
                    <span class="stat-value">$${formatNumber(portfolio.cash_account || 0)}</span>
                </div>
                <div class="stat-item">
                    <span class="stat-label">Total Stock Value</span>
                    <span class="stat-value">$${formatNumber(portfolio.total_stock_value || 0)}</span>
                </div>
                <div class="stat-item">
                    <span class="stat-label">Total Portfolio Value</span>
                    <span class="stat-value" style="font-size: 1.2em; font-weight: bold; color: var(--primary);">$${formatNumber(portfolio.total_portfolio_value || portfolio.cash_account || 0)}</span>
                </div>
                <div class="mt-3 mb-3">
                    <button class="btn btn-primary" onclick="showBuyStockModal(${portfolio.portfolio_id})">+ Buy Stock</button>
                    <button class="btn btn-secondary" onclick="showSellStockModal(${portfolio.portfolio_id})">Sell Stock</button>
                    <button class="btn btn-success" onclick="showDepositCashModal(${portfolio.portfolio_id})">+ Deposit Cash</button>
                    <button class="btn btn-warning" onclick="showWithdrawCashModal(${portfolio.portfolio_id})">- Withdraw Cash</button>
                    <button class="btn btn-info" onclick="showPortfolioStatistics(${portfolio.portfolio_id})">View Statistics</button>
                </div>
                <h4 class="mt-3">Holdings</h4>
                ${portfolio.holdings && portfolio.holdings.length > 0 ? `
                    <table class="table">
                        <thead>
                            <tr>
                                <th>Symbol</th>
                                <th>Shares</th>
                                <th>Latest Price</th>
                                <th>Value</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${portfolio.holdings.map(h => {
                                return `<tr>
                                    <td><strong>${h.symbol}</strong></td>
                                    <td>${formatNumber(h.shares)}</td>
                                    <td>$${formatNumber(h.latest_price || 0)}</td>
                                    <td>$${formatNumber(h.value || 0)}</td>
                                    <td>
                                        <button class="btn btn-sm btn-info" onclick="showStockHistory(${portfolio.portfolio_id}, '${h.symbol}')">History</button>
                                        <button class="btn btn-sm btn-primary" onclick="showStockPredictions(${portfolio.portfolio_id}, '${h.symbol}')">Predict</button>
                                    </td>
                                </tr>`;
                            }).join('')}
                        </tbody>
                    </table>
                ` : '<p class="text-muted">No holdings yet. Buy your first stock!</p>'}
            </div>
        `;
        
        showModal('portfolio-details-modal');
    } catch (error) {
        content.innerHTML = '<p class="text-muted">Failed to load portfolio details.</p>';
    }
}

function showCreatePortfolioModal() {
    document.getElementById('create-portfolio-form').reset();
    showModal('create-portfolio-modal');
}

function showBuyStockModal(portfolioId) {
    document.getElementById('buy-stock-portfolio-id').value = portfolioId;
    document.getElementById('buy-stock-form').reset();
    showModal('buy-stock-modal');
}

function showSellStockModal(portfolioId) {
    document.getElementById('sell-stock-portfolio-id').value = portfolioId;
    document.getElementById('sell-stock-form').reset();
    showModal('sell-stock-modal');
}

async function handleBuyStock(e) {
    e.preventDefault();
    const portfolioId = parseInt(document.getElementById('buy-stock-portfolio-id').value);
    const symbol = document.getElementById('buy-stock-symbol').value.toUpperCase().trim();
    const shares = parseFloat(document.getElementById('buy-stock-shares').value);
    const price = parseFloat(document.getElementById('buy-stock-price').value);
    
    if (!symbol || !shares || !price) {
        alert('Please fill in all fields.');
        return;
    }
    
    try {
        await PortfolioAPI.buyStock(portfolioId, symbol, shares, price);
        closeModal('buy-stock-modal');
        alert('Stock purchased successfully!');
        viewPortfolioDetails(portfolioId);
        loadPortfolios();
    } catch (error) {
        alert('Failed to buy stock: ' + error.message);
    }
}

async function handleSellStock(e) {
    e.preventDefault();
    const portfolioId = parseInt(document.getElementById('sell-stock-portfolio-id').value);
    const symbol = document.getElementById('sell-stock-symbol').value.toUpperCase().trim();
    const shares = parseFloat(document.getElementById('sell-stock-shares').value);
    const price = parseFloat(document.getElementById('sell-stock-price').value);
    
    if (!symbol || !shares || !price) {
        alert('Please fill in all fields.');
        return;
    }
    if (shares <= 0) {
        alert('Shares must be positive.');
        return;
    }
    
    try {
        await PortfolioAPI.sellStock(portfolioId, symbol, shares, price);
        closeModal('sell-stock-modal');
        alert('Stock sold successfully!');
        viewPortfolioDetails(portfolioId);
        loadPortfolios();
    } catch (error) {
        alert('Failed to sell stock: ' + error.message);
    }
}

function showModal(modalId) {
    document.getElementById(modalId)?.classList.add('active');
}

function closeModal(modalId) {
    document.getElementById(modalId)?.classList.remove('active');
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


function showDepositCashModal(portfolioId) {
    document.getElementById('deposit-cash-portfolio-id').value = portfolioId;
    document.getElementById('deposit-cash-form').reset();
    showModal('deposit-cash-modal');
}

function showWithdrawCashModal(portfolioId) {
    document.getElementById('withdraw-cash-portfolio-id').value = portfolioId;
    document.getElementById('withdraw-cash-form').reset();
    showModal('withdraw-cash-modal');
}

async function handleDepositCash(e) {
    e.preventDefault();
    const portfolioId = parseInt(document.getElementById('deposit-cash-portfolio-id').value);
    const amount = parseFloat(document.getElementById('deposit-amount').value);
    if (!amount || amount <= 0) {
        alert('Amount must be positive.');
        return;
    }
    try {
        await PortfolioAPI.depositCash(portfolioId, amount);
        closeModal('deposit-cash-modal');
        alert('Cash deposited successfully!');
        viewPortfolioDetails(portfolioId);
        loadPortfolios();
    } catch (error) {
        alert('Failed to deposit cash: ' + error.message);
    }
}

async function handleWithdrawCash(e) {
    e.preventDefault();
    const portfolioId = parseInt(document.getElementById('withdraw-cash-portfolio-id').value);
    const amount = parseFloat(document.getElementById('withdraw-amount').value);
    if (!amount || amount <= 0) {
        alert('Amount must be positive.');
        return;
    }
    try {
        await PortfolioAPI.withdrawCash(portfolioId, amount);
        closeModal('withdraw-cash-modal');
        alert('Cash withdrawn successfully!');
        viewPortfolioDetails(portfolioId);
        loadPortfolios();
    } catch (error) {
        alert('Failed to withdraw cash: ' + error.message);
    }
}

let currentStatisticsPortfolioId = null;

async function showPortfolioStatistics(portfolioId) {
    currentStatisticsPortfolioId = portfolioId;
    const modal = document.getElementById('portfolio-statistics-modal');
    const content = document.getElementById('portfolio-statistics-content');
    if (!modal || !content) return;
    content.innerHTML = '<p class="loading">Loading statistics...</p>';
    showModal('portfolio-statistics-modal');
    await loadPortfolioStatistics();
}

async function loadPortfolioStatistics() {
    if (!currentStatisticsPortfolioId) return;
    const content = document.getElementById('portfolio-statistics-content');
    const startDateInput = document.getElementById('stats-start-date');
    const endDateInput = document.getElementById('stats-end-date');
    const startDate = startDateInput?.value || null;
    const endDate = endDateInput?.value || null;
    
    try {
        const stats = await PortfolioAPI.getPortfolioStatistics(currentStatisticsPortfolioId, startDate, endDate);
        if (stats.message && (!stats.stocks || stats.stocks.length === 0)) {
            content.innerHTML = `<p class="text-muted">${stats.message}</p>`;
            return;
        }
        
        let html = '<h4>Stock Statistics</h4>';
        if (stats.stocks && stats.stocks.length > 0) {
            html += '<table class="table"><thead><tr>';
            html += '<th>Symbol</th><th>Coefficient of Variation</th><th>Beta</th>';
            html += '<th>Mean Price</th><th>Std Deviation</th><th>Data Points</th>';
            html += '</tr></thead><tbody>';
            stats.stocks.forEach(stock => {
                html += '<tr>';
                html += `<td><strong>${stock.symbol}</strong></td>`;
                html += `<td>${stock.coefficient_of_variation !== null ? stock.coefficient_of_variation.toFixed(4) : 'N/A'}</td>`;
                html += `<td>${stock.beta !== null ? stock.beta.toFixed(4) : 'N/A'}</td>`;
                html += `<td>$${stock.mean !== null ? formatNumber(stock.mean) : 'N/A'}</td>`;
                html += `<td>$${stock.std_dev !== null ? formatNumber(stock.std_dev) : 'N/A'}</td>`;
                html += `<td>${stock.data_points || 0}</td>`;
                html += '</tr>';
            });
            html += '</tbody></table>';
        }
        
        if (stats.correlation_matrix && stats.correlation_matrix.length > 0) {
            html += '<h4 class="mt-4">Correlation Matrix</h4><div style="overflow-x: auto;"><table class="table"><thead><tr><th></th>';
            (stats.symbols || []).forEach(symbol => {
                html += `<th>${symbol}</th>`;
            });
            html += '</tr></thead><tbody>';
            stats.correlation_matrix.forEach(row => {
                html += `<tr><td><strong>${row.symbol}</strong></td>`;
                row.correlations.forEach(corr => {
                    html += `<td>${corr !== null ? corr.toFixed(3) : 'N/A'}</td>`;
                });
                html += '</tr>';
            });
            html += '</tbody></table></div>';
        }
        content.innerHTML = html;
    } catch (error) {
        content.innerHTML = '<p class="text-muted">Failed to load statistics: ' + error.message + '</p>';
    }
}

let currentHistoryPortfolioId = null;
let currentHistorySymbol = null;
let historyChart = null;

async function showStockHistory(portfolioId, symbol) {
    currentHistoryPortfolioId = portfolioId;
    currentHistorySymbol = symbol;
    
    const modal = document.getElementById('stock-history-modal');
    const title = document.getElementById('stock-history-title');
    const content = document.getElementById('stock-history-content');
    const intervalSelect = document.getElementById('history-interval');
    
    if (!modal || !title || !content) return;
    
    title.textContent = `${symbol} Price History`;
    content.innerHTML = '<p class="loading">Loading history...</p>';
    showModal('stock-history-modal');
    
    await loadStockHistory(intervalSelect.value);
    
    intervalSelect.onchange = () => loadStockHistory(intervalSelect.value);
}

async function loadStockHistory(interval) {
    const content = document.getElementById('stock-history-content');
    
    try {
        const history = await PortfolioAPI.getStockHistory(currentHistoryPortfolioId, currentHistorySymbol, interval);
        
        if (!history.data || history.data.length === 0) {
            content.innerHTML = '<p class="text-muted">No historical data available for this interval.</p>';
            return;
        }
        
        if (historyChart) {
            historyChart.destroy();
        }
        
        let html = '<div style="max-height: 300px; overflow-y: auto; margin-bottom: 20px;">';
        html += '<table class="table"><thead><tr>';
        html += '<th>Date</th><th>Open</th><th>High</th><th>Low</th><th>Close</th><th>Volume</th>';
        html += '</tr></thead><tbody>';
        history.data.forEach(d => {
            html += '<tr>';
            html += `<td>${d.timestamp}</td>`;
            html += `<td>$${formatNumber(d.open)}</td>`;
            html += `<td>$${formatNumber(d.high)}</td>`;
            html += `<td>$${formatNumber(d.low)}</td>`;
            html += `<td>$${formatNumber(d.close)}</td>`;
            html += `<td>${d.volume.toLocaleString()}</td>`;
            html += '</tr>';
        });
        html += '</tbody></table></div>';
        html += '<div><canvas id="history-chart" style="max-height: 400px;"></canvas></div>';
        
        content.innerHTML = html;
        
        const ctx = document.getElementById('history-chart').getContext('2d');
        historyChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: history.data.map(d => d.timestamp),
                datasets: [{
                    label: 'Close Price',
                    data: history.data.map(d => d.close),
                    borderColor: 'rgb(75, 192, 192)',
                    backgroundColor: 'rgba(75, 192, 192, 0.2)',
                    tension: 0.1
                }]
            },
            options: {
                responsive: true,
                scales: {
                    y: {
                        beginAtZero: false
                    }
                }
            }
        });
    } catch (error) {
        content.innerHTML = '<p class="text-muted">Failed to load history: ' + error.message + '</p>';
    }
}

let currentPredictionsPortfolioId = null;
let currentPredictionsSymbol = null;
let predictionsChart = null;

async function showStockPredictions(portfolioId, symbol) {
    currentPredictionsPortfolioId = portfolioId;
    currentPredictionsSymbol = symbol;
    
    const modal = document.getElementById('stock-predictions-modal');
    const title = document.getElementById('stock-predictions-title');
    const content = document.getElementById('stock-predictions-content');
    const daysInput = document.getElementById('prediction-days');
    
    if (!modal || !title || !content) return;
    
    title.textContent = `${symbol} Price Predictions`;
    content.innerHTML = '<p class="loading">Loading predictions...</p>';
    showModal('stock-predictions-modal');
    
    await loadStockPredictions(parseInt(daysInput.value) || 30);
}

async function loadStockPredictions(days) {
    const content = document.getElementById('stock-predictions-content');
    
    try {
        const predictions = await PortfolioAPI.getStockPredictions(currentPredictionsPortfolioId, currentPredictionsSymbol, days);
        
        if (!predictions.predictions || predictions.predictions.length === 0) {
            content.innerHTML = '<p class="text-muted">' + (predictions.message || 'No predictions available.') + '</p>';
            return;
        }
        
        if (predictionsChart) {
            predictionsChart.destroy();
        }
        
        let html = '<div class="mb-3">';
        html += `<p><strong>Last Known Price:</strong> $${formatNumber(predictions.last_known_price)} on ${predictions.last_known_date}</p>`;
        html += `<p><strong>Prediction Method:</strong> ${predictions.method || 'linear_regression_with_mean_reversion'}</p>`;
        html += '</div>';
        html += '<div style="max-height: 300px; overflow-y: auto; margin-bottom: 20px;">';
        html += '<table class="table"><thead><tr>';
        html += '<th>Date</th><th>Predicted Price</th><th>Confidence Interval</th>';
        html += '</tr></thead><tbody>';
        predictions.predictions.forEach(p => {
            html += '<tr>';
            html += `<td>${p.date}</td>`;
            html += `<td>$${formatNumber(p.predicted_price)}</td>`;
            html += `<td>$${formatNumber(p.confidence_interval_low)} - $${formatNumber(p.confidence_interval_high)}</td>`;
            html += '</tr>';
        });
        html += '</tbody></table></div>';
        html += '<div><canvas id="predictions-chart" style="max-height: 400px;"></canvas></div>';
        
        content.innerHTML = html;
        
        const ctx = document.getElementById('predictions-chart').getContext('2d');
        predictionsChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: predictions.predictions.map(p => p.date),
                datasets: [{
                    label: 'Predicted Price',
                    data: predictions.predictions.map(p => p.predicted_price),
                    borderColor: 'rgb(255, 99, 132)',
                    backgroundColor: 'rgba(255, 99, 132, 0.2)',
                    tension: 0.1
                }, {
                    label: 'Confidence Interval (Low)',
                    data: predictions.predictions.map(p => p.confidence_interval_low),
                    borderColor: 'rgba(255, 99, 132, 0.3)',
                    borderDash: [5, 5],
                    fill: false
                }, {
                    label: 'Confidence Interval (High)',
                    data: predictions.predictions.map(p => p.confidence_interval_high),
                    borderColor: 'rgba(255, 99, 132, 0.3)',
                    borderDash: [5, 5],
                    fill: '+1'
                }]
            },
            options: {
                responsive: true,
                scales: {
                    y: {
                        beginAtZero: false
                    }
                }
            }
        });
    } catch (error) {
        content.innerHTML = '<p class="text-muted">Failed to load predictions: ' + error.message + '</p>';
    }
}

function updatePredictions() {
    const daysInput = document.getElementById('prediction-days');
    const days = parseInt(daysInput.value) || 30;
    loadStockPredictions(days);
}

window.viewPortfolioDetails = viewPortfolioDetails;
window.showCreatePortfolioModal = showCreatePortfolioModal;
window.showBuyStockModal = showBuyStockModal;
window.showSellStockModal = showSellStockModal;
window.showDepositCashModal = showDepositCashModal;
window.showWithdrawCashModal = showWithdrawCashModal;
window.showPortfolioStatistics = showPortfolioStatistics;
window.showStockHistory = showStockHistory;
window.showStockPredictions = showStockPredictions;
window.closeModal = closeModal;

