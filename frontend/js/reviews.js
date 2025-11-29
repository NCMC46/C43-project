let accessibleStockLists = [];
let selectedStockListId = null;
let currentReviewsData = null;
let currentReviews = [];

document.addEventListener('DOMContentLoaded', async function() {
    if (!requireAuth()) return;
    
    const user = getCurrentUser();
    if (user && document.getElementById('username-display')) {
        document.getElementById('username-display').textContent = user.username;
    }
    
    const form = document.getElementById('write-review-form');
    if (form) {
        form.addEventListener('submit', handleWriteReview);
    }
    
    await loadAccessibleStockLists();
});

async function loadAccessibleStockLists() {
    const selector = document.getElementById('stocklist-selector');
    const reviewsList = document.getElementById('reviews-list');
    if (!selector || !reviewsList) return;
    
    reviewsList.innerHTML = '<p class="text-muted">Loading accessible stock lists...</p>';
    
    try {
        accessibleStockLists = await StockListAPI.getAccessibleStockLists();
        
        if (!accessibleStockLists || accessibleStockLists.length === 0) {
            selector.innerHTML = '<option value="">No accessible stock lists</option>';
            document.getElementById('stocklist-info').innerHTML = '<p class="text-muted">You have no accessible stock lists yet.</p>';
            reviewsList.innerHTML = '<p class="text-muted">Create or gain access to a stock list to write a review.</p>';
            return;
        }
        
        selector.innerHTML = accessibleStockLists.map(list => `
            <option value="${list.stock_list_id}">
                #${list.stock_list_id} - ${list.visibility.toUpperCase()} (${list.creator || 'Unknown'})
            </option>
        `).join('');
        
        selector.addEventListener('change', handleStockListChange);
        
        selectedStockListId = accessibleStockLists[0].stock_list_id;
        selector.value = selectedStockListId;
        await loadReviewsForSelected();
    } catch (error) {
        
        reviewsList.innerHTML = '<p class="text-muted">Failed to load accessible stock lists.</p>';
    }
}

function handleStockListChange(event) {
    selectedStockListId = parseInt(event.target.value) || null;
    loadReviewsForSelected();
}

async function loadReviewsForSelected() {
    const reviewsList = document.getElementById('reviews-list');
    const infoContainer = document.getElementById('stocklist-info');
    const noteContainer = document.getElementById('reviews-note');
    
    if (!selectedStockListId) {
        infoContainer.innerHTML = '<p class="text-muted">Select a stock list to view its details.</p>';
        reviewsList.innerHTML = '<p class="text-muted">Select a stock list to view reviews.</p>';
        if (noteContainer) noteContainer.style.display = 'none';
        return;
    }
    
    reviewsList.innerHTML = '<p class="text-muted">Loading reviews...</p>';
    
    try {
        currentReviewsData = await ReviewsAPI.getReviews(selectedStockListId);
        currentReviews = currentReviewsData.reviews || [];
        
        renderStockListInfo(currentReviewsData);
        
        if (noteContainer) {
            if (currentReviewsData.note) {
                noteContainer.textContent = currentReviewsData.note;
                noteContainer.style.display = 'block';
            } else {
                noteContainer.style.display = 'none';
            }
        }
        
        if (currentReviews.length === 0) {
            reviewsList.innerHTML = '<p class="text-muted">No reviews yet. Be the first to write one!</p>';
            return;
        }
        
        const user = getCurrentUser();
        reviewsList.innerHTML = currentReviews.map(review => `
            <div class="review-item">
                <div class="review-header">
                    <strong>${review.username}</strong>
                    <small class="text-muted">${formatDate(review.updated_at || review.created_at)}</small>
                </div>
                <p>${escapeHtml(review.content)}</p>
                <div class="review-actions">
                    ${review.can_edit ? `<button class="btn btn-sm btn-secondary" onclick="showWriteReviewModal()">Edit</button>` : ''}
                    ${review.can_delete ? `<button class="btn btn-sm btn-danger" onclick="deleteReview(${review.review_id})">Delete</button>` : ''}
                </div>
            </div>
        `).join('');
    } catch (error) {
        
        reviewsList.innerHTML = '<p class="text-muted">No reviews yet. Be the first to write one!</p>';
    }
}

function renderStockListInfo(data) {
    const container = document.getElementById('stocklist-info');
    if (!container) return;
    
    container.innerHTML = `
        <div class="stat-grid">
            <div class="stat-item">
                <span class="stat-label">Stock List</span>
                <span class="stat-value">#${data.stock_list_id}</span>
            </div>
            <div class="stat-item">
                <span class="stat-label">Visibility</span>
                <span class="stat-value text-capitalize">${data.visibility}</span>
            </div>
            <div class="stat-item">
                <span class="stat-label">Creator</span>
                <span class="stat-value">${data.creator || 'Unknown'}</span>
            </div>
        </div>
    `;
}

function showWriteReviewModal() {
    if (!selectedStockListId) {
        showError('Please select a stock list first.');
        return;
    }
    
    const label = document.getElementById('selected-stocklist-label');
    if (label) {
        label.textContent = `Stock List #${selectedStockListId} - ${currentReviewsData?.visibility?.toUpperCase() || ''}`;
    }
    
    const textarea = document.getElementById('review-content');
    const user = getCurrentUser();
    const existing = currentReviews.find(r => r.username === user.username);
    textarea.value = existing ? existing.content : '';
    
    const title = document.getElementById('review-modal-title');
    if (title) {
        title.textContent = existing ? 'Edit Your Review' : 'Write a Review';
    }
    
    showModal('write-review-modal');
}

async function handleWriteReview(event) {
    event.preventDefault();
    
    if (!selectedStockListId) {
        showError('Please select a stock list first.');
        return;
    }
    
    const content = document.getElementById('review-content').value.trim();
    if (!content) {
        showError('Review content cannot be empty.');
        return;
    }
    
    if (content.length > 4000) {
        showError('Review content must be 4000 characters or less.');
        return;
    }
    
    try {
        await ReviewsAPI.saveReview(selectedStockListId, content);
        closeModal('write-review-modal');
        showSuccess('Review saved successfully!');
        await loadReviewsForSelected();
    } catch (error) {
        
        showError('Failed to save review: ' + error.message);
    }
}

async function deleteReview(reviewId) {
    if (!selectedStockListId) return;
    
    if (!confirm('Are you sure you want to delete this review?')) {
        return;
    }
    
    try {
        await ReviewsAPI.deleteReview(selectedStockListId, reviewId);
        showSuccess('Review deleted.');
        await loadReviewsForSelected();
    } catch (error) {
        
        showError('Failed to delete review: ' + error.message);
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

function formatDate(dateString) {
    if (!dateString) return 'Unknown date';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}


window.showWriteReviewModal = showWriteReviewModal;
window.closeModal = closeModal;
