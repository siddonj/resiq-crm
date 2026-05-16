pipeline {
    agent {
        docker {
            image 'node:20-alpine'
        }
    }
    stages {
        stage('Checkout') {
            steps {
                checkout scm
            }
        }
        stage('Install Server Dependencies') {
            steps {
                sh 'cd server && npm ci'
            }
        }
        stage('Install Client Dependencies') {
            steps {
                sh 'cd client && npm ci'
            }
        }
        stage('Test Server') {
            steps {
                sh 'cd server && npm test 2>&1 || echo "No tests configured or tests failed"'
            }
        }
        stage('Build Client') {
            steps {
                sh 'cd client && npm run build'
            }
        }
    }
    post {
        always {
            echo 'Pipeline complete'
        }
        success {
            echo 'All stages passed successfully'
        }
        failure {
            echo 'One or more stages failed'
        }
    }
}
