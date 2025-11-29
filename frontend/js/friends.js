
document.addEventListener('DOMContentLoaded', function() {
    if (!requireAuth()) return;
    
    const user = getCurrentUser();
    if (user && document.getElementById('username-display')) {
        document.getElementById('username-display').textContent = user.username;
    }
    
    loadFriends();
    
    const sendRequestForm = document.getElementById('send-request-form');
    if (sendRequestForm) {
        sendRequestForm.addEventListener('submit', handleSendFriendRequest);
    }
});

function switchTab(event, tabName) {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    if (event && event.target) {
        event.target.classList.add('active');
    }
    
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
    });
    document.getElementById(tabName).classList.add('active');
    
    if (tabName === 'friends') {
        loadFriends();
    } else if (tabName === 'incoming') {
        loadIncomingRequests();
    } else if (tabName === 'outgoing') {
        loadOutgoingRequests();
    }
}

async function loadFriends() {
    const friendsList = document.getElementById('friends-list');
    if (!friendsList) return;
    
    friendsList.innerHTML = '<p class="text-muted">Loading friends...</p>';
    
    try {
        const friends = await FriendsAPI.getFriends();
        
        if (friends.length === 0) {
            friendsList.innerHTML = '<p class="text-muted">No friends yet. Send some friend requests!</p>';
            return;
        }
        
        friendsList.innerHTML = friends.map(friend => `
            <div class="friend-item">
                <div>
                    <strong>${friend}</strong>
                    <p class="text-muted">Friend</p>
                </div>
                <button class="btn btn-sm btn-danger" onclick="removeFriend('${friend}')">
                    Remove
                </button>
            </div>
        `).join('');
    } catch (error) {
        
        friendsList.innerHTML = '<p class="text-muted">Failed to load friends.</p>';
    }
}

async function loadIncomingRequests() {
    const requestsList = document.getElementById('incoming-requests-list');
    if (!requestsList) return;
    
    requestsList.innerHTML = '<p class="text-muted">Loading incoming requests...</p>';
    
    try {
        const requests = await FriendsAPI.getIncomingRequests();
        
        if (requests.length === 0) {
            requestsList.innerHTML = '<p class="text-muted">No incoming friend requests.</p>';
            return;
        }
        
        requestsList.innerHTML = requests.map(fromUser => `
            <div class="request-item">
                <div>
                    <strong>${fromUser}</strong>
                    <p class="text-muted">Sent you a friend request</p>
                </div>
                <div>
                    <button class="btn btn-sm btn-success" onclick="acceptRequest('${fromUser}')">
                        Accept
                    </button>
                    <button class="btn btn-sm btn-danger" onclick="rejectRequest('${fromUser}')">
                        Reject
                    </button>
                </div>
            </div>
        `).join('');
    } catch (error) {
        
        requestsList.innerHTML = '<p class="text-muted">Failed to load incoming requests.</p>';
    }
}

async function loadOutgoingRequests() {
    const requestsList = document.getElementById('outgoing-requests-list');
    if (!requestsList) return;
    
    requestsList.innerHTML = '<p class="text-muted">Loading outgoing requests...</p>';
    
    try {
        const requests = await FriendsAPI.getOutgoingRequests();
        
        if (requests.length === 0) {
            requestsList.innerHTML = '<p class="text-muted">No outgoing friend requests.</p>';
            return;
        }
        
        requestsList.innerHTML = requests.map(toUser => `
            <div class="request-item">
                <div>
                    <strong>${toUser}</strong>
                    <p class="text-muted">Pending</p>
                </div>
                <span class="text-muted">Waiting for response...</span>
            </div>
        `).join('');
    } catch (error) {
        
        requestsList.innerHTML = '<p class="text-muted">Failed to load outgoing requests.</p>';
    }
}

async function handleSendFriendRequest(e) {
    e.preventDefault();
    
    const username = document.getElementById('friend-username').value.trim();
    
    if (!username) {
        alert('Please enter a username.');
        return;
    }
    
    try {
        const result = await FriendsAPI.sendFriendRequest(username);
        closeModal('send-request-modal');
        document.getElementById('send-request-form').reset();
        loadOutgoingRequests();
        alert(result?.message || 'Friend request sent successfully!');
    } catch (error) {
        
        alert('Failed to send friend request: ' + error.message);
    }
}

async function acceptRequest(fromUsername) {
    try {
        const result = await FriendsAPI.acceptFriendRequest(fromUsername);
        loadIncomingRequests();
        loadFriends();
        alert(result?.message || 'Friend request accepted!');
    } catch (error) {
        
        alert('Failed to accept friend request: ' + error.message);
    }
}

async function rejectRequest(fromUsername) {
    try {
        const result = await FriendsAPI.rejectFriendRequest(fromUsername);
        loadIncomingRequests();
        alert(result?.message || 'Friend request rejected.');
    } catch (error) {
        
        alert('Failed to reject friend request: ' + error.message);
    }
}

async function removeFriend(friendUsername) {
    if (!confirm(`Are you sure you want to remove ${friendUsername} from your friends?`)) {
        return;
    }
    
    try {
        const result = await FriendsAPI.removeFriend(friendUsername);
        alert(result?.message || 'Friend removed successfully!');
        loadFriends();
        loadOutgoingRequests();
    } catch (error) {
        
        alert('Failed to remove friend: ' + error.message);
    }
}

function showSendRequestModal() {
    document.getElementById('send-request-form').reset();
    showModal('send-request-modal');
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


window.switchTab = switchTab;
window.acceptRequest = acceptRequest;
window.rejectRequest = rejectRequest;
window.removeFriend = removeFriend;
window.showSendRequestModal = showSendRequestModal;
window.closeModal = closeModal;


