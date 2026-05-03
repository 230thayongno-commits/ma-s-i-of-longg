const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
const server = http.createServer(app);
const io = new Server(server, {
    cors: { 
        origin: "*", // Để dấu sao luôn cho t, chấp hết mọi loại link Vercel 💅
        methods: ["GET", "POST"]
    }
});

// Database chạy bằng cơm (ram)
const users = {}; 
const rooms = {}; 

// Danh sách 27 roles m yêu cầu
const ALL_ROLES = [
    'Dân Làng', 'Tiên Tri', 'Bảo Vệ', 'Thợ Săn', 'Phù Thủy', 'Thần Tình Yêu', 
    'Chị Em', 'Thị Trưởng', 'Hoàng Tử', 'Người Thổi Còi', 'Già Làng', 'Thám Tử', 
    'Người Hóa Sói', 'Tiên Tri Tập Sự', 'Ma Sói', 'Sói Con', 'Pháp Sư Sói', 
    'Kẻ Phản Bội', 'Sói Huyền Bí', 'Sói Đầu Đàn', 'Sói Mơ Ngủ', 'Kẻ Chán Đời', 
    'Ma Cà Rồng', 'Trưởng Giáo Phái', 'Kẻ Ám Sát', 'Người Thay Đổi', 'Đứa Trẻ Hoang Dã'
];

io.on('connection', (socket) => {
    console.log('Có ng mới vô nè: ', socket.id);

    // 1. TẠO TÀI KHOẢN
    socket.on('register', (data) => {
        const { nickname, username, password } = data;
        if (users[username]) {
            return socket.emit('register_error', { msg: 'Tên này có ng xài r, chọn tên khác giùm t 🙄' });
        }
        users[username] = {
            nickname: nickname,
            password: password, // Mốt làm game thật nhớ mã hoá nha m
            skin: 'nam', // Mặc định
            socketId: socket.id,
            currentRoom: null
        };
        socket.emit('register_success', { username, nickname });
    });

    // 2. CHỌN SKIN (Nam / Nữ)
    socket.on('set_skin', (data) => {
        const { username, skin } = data;
        if (users[username]) {
            users[username].skin = skin;
            socket.emit('skin_updated', { skin });
        }
    });

    // 3. TẠO PHÒNG
    socket.on('create_room', (data) => {
        const { username, setupType, customRoles, maxPlayers } = data; // setupType: 'auto' hoặc 'manual'
        
        if (maxPlayers < 5) {
            return socket.emit('room_error', { msg: 'Game này chơi dưới 5 ng chán lắm m, tăng lên 💀' });
        }

        const roomId = Math.random().toString(36).substring(2, 8);
        rooms[roomId] = {
            id: roomId,
            host: username,
            players: [{ username, nickname: users[username].nickname, skin: users[username].skin }],
            maxPlayers: maxPlayers,
            status: 'waiting', // waiting, playing
            setupType: setupType, 
            customRoles: setupType === 'manual' ? customRoles : [], 
            rolesAssigned: {}
        };

        users[username].currentRoom = roomId;
        socket.join(roomId);
        socket.emit('room_created', { roomId, room: rooms[roomId] });
    });

    // 4. VÀO PHÒNG BẰNG ID HOẶC TỪ DANH SÁCH
    socket.on('join_room', (data) => {
        const { username, roomId } = data;
        const room = rooms[roomId];

        if (!room) return socket.emit('room_error', { msg: 'Phòng k tồn tại m ơi 💀' });
        if (room.status !== 'waiting') return socket.emit('room_error', { msg: 'Phòng đang chơi r, chịu khó đợi ván sau nha' });
        if (room.players.length >= room.maxPlayers) return socket.emit('room_error', { msg: 'Phòng full cmnr 😭' });

        room.players.push({ username, nickname: users[username].nickname, skin: users[username].skin });
        users[username].currentRoom = roomId;
        socket.join(roomId);
        
        io.to(roomId).emit('player_joined', { room });
    });

    // 5. TÌM PHÒNG TỰ ĐỘNG (QUICK JOIN)
    socket.on('quick_join', (data) => {
        const { username } = data;
        let foundRoom = null;

        for (const roomId in rooms) {
            if (rooms[roomId].status === 'waiting' && rooms[roomId].players.length < rooms[roomId].maxPlayers) {
                foundRoom = roomId;
                break;
            }
        }

        if (foundRoom) {
            // Tái sử dụng logic join_room
            rooms[foundRoom].players.push({ username, nickname: users[username].nickname, skin: users[username].skin });
            users[username].currentRoom = foundRoom;
            socket.join(foundRoom);
            io.to(foundRoom).emit('player_joined', { room: rooms[foundRoom] });
            socket.emit('quick_join_success', { roomId: foundRoom, room: rooms[foundRoom] });
        } else {
            socket.emit('room_error', { msg: 'Hiện k cs phòng nào trống, m tự tạo phòng đi 💅' });
        }
    });

    // LẤY DANH SÁCH PHÒNG
    socket.on('get_rooms', () => {
        const availableRooms = Object.values(rooms).filter(r => r.status === 'waiting');
        socket.emit('room_list', availableRooms);
    });

    // 6. BẮT ĐẦU GAME VÀ CHIA VAI TRÒ
    socket.on('start_game', (data) => {
        const { username, roomId } = data;
        const room = rooms[roomId];

        if (!room || room.host !== username) return;
        if (room.players.length < 5) return socket.emit('room_error', { msg: 'Chưa đủ 5 ng sao chơi m 🤡' });

        room.status = 'playing';
        let pool = [];

        // Chia bài
        if (room.setupType === 'auto') {
            // Tự động: 1 Sói, 1 Tiên tri, 1 Bảo vệ, còn lại Dân làng (Basic logic cho m tuỳ chỉnh thêm)
            pool.push('Ma Sói', 'Tiên Tri', 'Bảo Vệ');
            while(pool.length < room.players.length) pool.push('Dân Làng');
        } else {
            // Manual: Bốc từ list host chọn
            pool = [...room.customRoles];
        }

        // Đảo trộn mảng vai trò
        pool = pool.sort(() => Math.random() - 0.5);

        room.players.forEach((player, index) => {
            room.rolesAssigned[player.username] = pool[index];
            // Bắn role ẩn về cho từng thằng
            const playerSocket = users[player.username].socketId;
            io.to(playerSocket).emit('your_role', { role: pool[index] });
        });

        io.to(roomId).emit('game_started', { msg: 'Trời tối r, ae nhắm mắt lại ✨' });
    });

    // Xử lý văng mạng
    socket.on('disconnect', () => {
        console.log('Có đứa out: ', socket.id);
        // Logic xoá ng chơi khỏi phòng nếu cần m tự múa thêm nx nha
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server chạy ở port ${PORT}`);
});
