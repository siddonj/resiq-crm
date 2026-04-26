// WebSocket connection manager for real-time updates
class TicketWebSocketManager {
  constructor(url, token) {
    this.url = url || `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}`
    this.token = token
    this.ws = null
    this.callbacks = {}
    this.reconnectAttempts = 0
    this.maxReconnectAttempts = 5
    this.reconnectDelay = 3000
    this.isIntentionallyClosed = false
  }

  connect() {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(`${this.url}/ws/tickets`, [`Bearer ${this.token}`])
        
        this.ws.onopen = () => {
          console.log('✓ WebSocket connected')
          this.reconnectAttempts = 0
          this.isIntentionallyClosed = false
          this.emit('connected')
          resolve()
        }

        this.ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data)
            console.log('📨 WebSocket message received:', data)
            
            if (data.type === 'ticket_updated') {
              this.emit('ticket_updated', data.ticket)
            } else if (data.type === 'ticket_created') {
              this.emit('ticket_created', data.ticket)
            } else if (data.type === 'reply_added') {
              this.emit('reply_added', data.reply)
            } else if (data.type === 'pong') {
              // Respond to server ping
              console.log('Received pong from server')
            }
          } catch (err) {
            console.error('Error parsing WebSocket message:', err)
          }
        }

        this.ws.onerror = (error) => {
          console.error('WebSocket error:', error)
          this.emit('error', error)
          reject(error)
        }

        this.ws.onclose = () => {
          console.log('WebSocket disconnected')
          this.emit('disconnected')
          
          if (!this.isIntentionallyClosed && this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++
            console.log(`Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts}) in ${this.reconnectDelay}ms...`)
            setTimeout(() => this.connect(), this.reconnectDelay)
          }
        }
      } catch (err) {
        console.error('Error creating WebSocket:', err)
        reject(err)
      }
    })
  }

  disconnect() {
    this.isIntentionallyClosed = true
    if (this.ws) {
      this.ws.close()
    }
  }

  send(message) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message))
    } else {
      console.warn('WebSocket is not connected')
    }
  }

  // Subscribe to events
  on(eventName, callback) {
    if (!this.callbacks[eventName]) {
      this.callbacks[eventName] = []
    }
    this.callbacks[eventName].push(callback)
    
    // Return unsubscribe function
    return () => {
      this.callbacks[eventName] = this.callbacks[eventName].filter(cb => cb !== callback)
    }
  }

  // Emit events
  emit(eventName, data) {
    if (this.callbacks[eventName]) {
      this.callbacks[eventName].forEach(callback => {
        try {
          callback(data)
        } catch (err) {
          console.error(`Error in callback for ${eventName}:`, err)
        }
      })
    }
  }

  isConnected() {
    return this.ws && this.ws.readyState === WebSocket.OPEN
  }
}

// Create singleton instance
let wsInstance = null

export function getTicketWebSocket(token) {
  if (!wsInstance && token) {
    wsInstance = new TicketWebSocketManager(null, token)
  }
  return wsInstance
}

export default TicketWebSocketManager
