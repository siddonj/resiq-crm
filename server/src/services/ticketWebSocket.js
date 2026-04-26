// WebSocket handler for real-time ticket updates
// Uses native WebSocket protocol with Express HTTP upgrade

class TicketWebSocketServer {
  constructor() {
    this.clients = new Map() // userId -> Set of WebSocket connections
    this.ticketSubscriptions = new Map() // ticketId -> Set of userIds
  }

  // Called from server index.js in the HTTP upgrade handler
  handleUpgrade(ws, req, userId) {
    if (!userId) {
      ws.close(1008, 'Unauthorized')
      return
    }

    console.log(`✓ WebSocket client connected: user ${userId}`)

    // Store client connection
    if (!this.clients.has(userId)) {
      this.clients.set(userId, new Set())
    }
    this.clients.get(userId).add(ws)

    // Handle incoming messages
    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data)
        this.handleMessage(ws, userId, message)
      } catch (err) {
        console.error('Error parsing WebSocket message:', err)
        ws.send(JSON.stringify({ type: 'error', message: 'Invalid message format' }))
      }
    })

    // Handle client disconnect
    ws.on('close', () => {
      console.log(`WebSocket client disconnected: user ${userId}`)
      const userConnections = this.clients.get(userId)
      if (userConnections) {
        userConnections.delete(ws)
        if (userConnections.size === 0) {
          this.clients.delete(userId)
        }
      }
    })

    // Handle errors
    ws.on('error', (error) => {
      console.error('WebSocket error:', error)
    })

    // Send connection confirmation
    ws.send(JSON.stringify({ type: 'connected', message: 'Connected to ticket updates' }))
  }

  handleMessage(ws, userId, message) {
    switch (message.type) {
      case 'subscribe':
        this.subscribeToTicket(userId, message.ticketId)
        ws.send(JSON.stringify({ type: 'subscribed', ticketId: message.ticketId }))
        break

      case 'unsubscribe':
        this.unsubscribeFromTicket(userId, message.ticketId)
        ws.send(JSON.stringify({ type: 'unsubscribed', ticketId: message.ticketId }))
        break

      case 'ping':
        ws.send(JSON.stringify({ type: 'pong' }))
        break

      default:
        console.warn('Unknown message type:', message.type)
    }
  }

  subscribeToTicket(userId, ticketId) {
    if (!this.ticketSubscriptions.has(ticketId)) {
      this.ticketSubscriptions.set(ticketId, new Set())
    }
    this.ticketSubscriptions.get(ticketId).add(userId)
    console.log(`User ${userId} subscribed to ticket ${ticketId}`)
  }

  unsubscribeFromTicket(userId, ticketId) {
    const subscribers = this.ticketSubscriptions.get(ticketId)
    if (subscribers) {
      subscribers.delete(userId)
      if (subscribers.size === 0) {
        this.ticketSubscriptions.delete(ticketId)
      }
    }
  }

  // Called from ticket route when ticket is updated
  broadcastTicketUpdate(ticketId, ticket) {
    const subscribers = this.ticketSubscriptions.get(ticketId)
    if (subscribers) {
      const message = JSON.stringify({ type: 'ticket_updated', ticket })
      subscribers.forEach((userId) => {
        const connections = this.clients.get(userId)
        if (connections) {
          connections.forEach((ws) => {
            if (ws.readyState === 1) { // OPEN
              ws.send(message)
            }
          })
        }
      })
      console.log(`✓ Broadcast ticket update to ${subscribers.size} users`)
    }
  }

  // Called from ticket route when ticket is created
  broadcastTicketCreated(ticket) {
    // Broadcast to all connected users (help desk users)
    const message = JSON.stringify({ type: 'ticket_created', ticket })
    this.clients.forEach((connections) => {
      connections.forEach((ws) => {
        if (ws.readyState === 1) { // OPEN
          ws.send(message)
        }
      })
    })
    console.log(`✓ Broadcast new ticket to ${this.clients.size} users`)
  }

  // Called from ticket route when reply is added
  broadcastReplyAdded(ticketId, reply) {
    const subscribers = this.ticketSubscriptions.get(ticketId)
    if (subscribers) {
      const message = JSON.stringify({ type: 'reply_added', ticketId, reply })
      subscribers.forEach((userId) => {
        const connections = this.clients.get(userId)
        if (connections) {
          connections.forEach((ws) => {
            if (ws.readyState === 1) { // OPEN
              ws.send(message)
            }
          })
        }
      })
      console.log(`✓ Broadcast reply to ${subscribers.size} users`)
    }
  }

  getStats() {
    return {
      connectedUsers: this.clients.size,
      totalConnections: Array.from(this.clients.values()).reduce((sum, set) => sum + set.size, 0),
      subscribedTickets: this.ticketSubscriptions.size,
    }
  }
}

module.exports = TicketWebSocketServer
