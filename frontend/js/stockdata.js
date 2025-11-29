
document.addEventListener('DOMContentLoaded', function() {
    if (!requireAuth()) return;
    
    const user = getCurrentUser();
    if (user && document.getElementById('username-display')) {
        document.getElementById('username-display').textContent = user.username;
    }
    
    const stockDataForm = document.getElementById('stock-data-form');
    if (stockDataForm) {
        stockDataForm.addEventListener('submit', handleRecordStockData);
    }
    
    const today = new Date().toISOString().split('T')[0];
    const timestampInput = document.getElementById('stock-timestamp');
    if (timestampInput) {
        timestampInput.value = today;
    }
    
    const highInput = document.getElementById('stock-high');
    const lowInput = document.getElementById('stock-low');
    const openInput = document.getElementById('stock-open');
    const closeInput = document.getElementById('stock-close');
    
    [highInput, lowInput, openInput, closeInput].forEach(input => {
        if (input) {
            input.addEventListener('blur', validatePriceLogic);
        }
    });
});

function validatePriceLogic() {
    const high = parseFloat(document.getElementById('stock-high').value) || 0;
    const low = parseFloat(document.getElementById('stock-low').value) || 0;
    const open = parseFloat(document.getElementById('stock-open').value) || 0;
    const close = parseFloat(document.getElementById('stock-close').value) || 0;
    
    const errorDiv = document.getElementById('form-error');
    
    if (high > 0 && low > 0 && low > high) {
        errorDiv.textContent = 'Error: Low price cannot be greater than high price';
        errorDiv.style.display = 'block';
        return false;
    }
    
    if (high > 0 && open > 0 && open > high) {
        errorDiv.textContent = 'Error: Open price cannot be greater than high price';
        errorDiv.style.display = 'block';
        return false;
    }
    
    if (high > 0 && close > 0 && close > high) {
        errorDiv.textContent = 'Error: Close price cannot be greater than high price';
        errorDiv.style.display = 'block';
        return false;
    }
    
    if (low > 0 && open > 0 && open < low) {
        errorDiv.textContent = 'Error: Open price cannot be less than low price';
        errorDiv.style.display = 'block';
        return false;
    }
    
    if (low > 0 && close > 0 && close < low) {
        errorDiv.textContent = 'Error: Close price cannot be less than low price';
        errorDiv.style.display = 'block';
        return false;
    }
    
    errorDiv.style.display = 'none';
    return true;
}

async function handleRecordStockData(e) {
    e.preventDefault();
    
    const errorDiv = document.getElementById('form-error');
    errorDiv.style.display = 'none';
    
    const symbol = document.getElementById('stock-symbol').value.toUpperCase().trim();
    const timestamp = document.getElementById('stock-timestamp').value;
    const open = parseFloat(document.getElementById('stock-open').value);
    const high = parseFloat(document.getElementById('stock-high').value);
    const low = parseFloat(document.getElementById('stock-low').value);
    const close = parseFloat(document.getElementById('stock-close').value);
    const volume = parseInt(document.getElementById('stock-volume').value);
    
    if (!symbol || !timestamp || isNaN(open) || isNaN(high) || isNaN(low) || isNaN(close) || isNaN(volume)) {
        errorDiv.textContent = 'Please fill in all fields with valid values.';
        errorDiv.style.display = 'block';
        return;
    }
    
    if (low > high) {
        errorDiv.textContent = 'Error: Low price cannot be greater than high price';
        errorDiv.style.display = 'block';
        return;
    }
    
    if (open < 0 || high < 0 || low < 0 || close < 0 || volume < 0) {
        errorDiv.textContent = 'Error: All prices and volume must be non-negative';
        errorDiv.style.display = 'block';
        return;
    }
    
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(timestamp)) {
        errorDiv.textContent = 'Error: Date must be in YYYY-MM-DD format';
        errorDiv.style.display = 'block';
        return;
    }
    
    try {
        const result = await StockDataAPI.recordStockData(symbol, timestamp, open, high, low, close, volume);
        
        if (result.success) {
            showSuccess('Stock data recorded successfully!');
            clearForm();
        } else {
            throw new Error(result.message || 'Failed to record stock data');
        }
    } catch (error) {
        
        errorDiv.textContent = 'Error: ' + (error.message || 'Failed to record stock data');
        errorDiv.style.display = 'block';
    }
}

function clearForm() {
    document.getElementById('stock-data-form').reset();
    
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('stock-timestamp').value = today;
    
    document.getElementById('form-error').style.display = 'none';
}



